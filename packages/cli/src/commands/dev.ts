import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { createServer } from 'http';
import type { FSWatcher } from 'chokidar';
import { detectProject, type DetectedProject } from '../detector.js';
import { discoverRoutes, type RouteFileMap } from '../dev/route-discovery.js';
import { crawlRoutes } from '../dev/route-checker.js';
import { startLocalServer, printSessionSummary } from '../dev/local-server.js';
import { startFileWatcher } from '../dev/file-watcher.js';

interface DevOptions {
  command?: string;
  port?: number;
}

// ─── Helper functions ───

function hasInstrumentInPackageJson(cwd: string): boolean {
  const packageJsonPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return !!(packageJson.dependencies?.['@scanwarp/instrument'] ||
              packageJson.devDependencies?.['@scanwarp/instrument']);
  } catch {
    return false;
  }
}

function checkProductionSetup(cwd: string): boolean {
  const hasVercelConfig = fs.existsSync(path.join(cwd, '.vercel'));
  const hasRailwayConfig = fs.existsSync(path.join(cwd, 'railway.json')) ||
                           fs.existsSync(path.join(cwd, 'railway.toml'));
  const hasRenderConfig = fs.existsSync(path.join(cwd, 'render.yaml'));

  const isUsingHosting = hasVercelConfig || hasRailwayConfig || hasRenderConfig;

  if (!isUsingHosting) {
    return true;
  }

  const hasInstrumentationFile = fs.existsSync(path.join(cwd, 'instrumentation.ts')) ||
                                  fs.existsSync(path.join(cwd, 'instrumentation.js'));

  const hasInstrumentPackage = hasInstrumentInPackageJson(cwd);

  return hasInstrumentationFile || hasInstrumentPackage;
}

// ─── Main dev command ───

export async function devCommand(options: DevOptions = {}) {
  const cwd = process.cwd();

  console.log(chalk.bold.cyan('\n⚡ ScanWarp Dev Mode\n'));

  // Step 1: Detect project
  const spinner = ora('Detecting project...').start();
  const detected = detectProject(cwd);
  spinner.succeed(
    `Detected: ${detected.framework || 'Node.js'}${detected.services.length > 0 ? ` + ${detected.services.join(', ')}` : ''}`
  );

  const hasProductionSetup = checkProductionSetup(cwd);
  if (!hasProductionSetup) {
    console.log(chalk.yellow('\n⚠️  Production hosting detected but monitoring not configured!'));
    console.log(chalk.gray('   Run `npx scanwarp init` to enable production monitoring.'));
    console.log(chalk.gray('   This ensures you get alerts and AI diagnosis in production.\n'));
  }

  // Step 2: Determine the dev command
  const devCmd = options.command || detectDevCommand(detected, cwd);
  console.log(chalk.gray(`  Dev command: ${devCmd}\n`));

  // Step 3: Discover routes
  const routeFileMap: RouteFileMap = {
    fileToRoute: new Map(),
    fileToType: new Map(),
  };
  const routes = discoverRoutes(detected, cwd, routeFileMap);
  if (routes.pages.length > 0 || routes.apiRoutes.length > 0) {
    console.log(
      chalk.green(`  Found ${routes.pages.length} pages, ${routes.apiRoutes.length} API routes`)
    );
  }

  // Step 4: Start in-memory ScanWarp server
  const scanwarpPort = options.port || (await findAvailablePort(3456));
  const { server: scanwarpServer, store } = await startLocalServer(scanwarpPort);

  store.routes = routes;

  console.log(
    chalk.green(`  ScanWarp local server: http://localhost:${scanwarpPort}\n`)
  );

  // Print MCP configuration instructions
  console.log(chalk.bold('  MCP for AI coding tools:\n'));
  console.log(chalk.gray(`  Add to your MCP config (.cursor/mcp.json or claude_desktop_config.json):`));
  console.log(chalk.gray(`  {`));
  console.log(chalk.gray(`    "mcpServers": {`));
  console.log(chalk.white(`      "scanwarp-dev": {`));
  console.log(chalk.white(`        "command": "npx",`));
  console.log(chalk.white(`        "args": ["scanwarp", "dev-mcp", "--port", "${scanwarpPort}"]`));
  console.log(chalk.white(`      }`));
  console.log(chalk.gray(`    }`));
  console.log(chalk.gray(`  }\n`));

  // Print browser monitoring instructions
  console.log(chalk.bold('  🔍 Browser error monitoring:\n'));
  console.log(chalk.gray(`  Add this script tag to your HTML <head> for frontend error capture:`));
  console.log(chalk.cyan(`  <script src="http://localhost:${scanwarpPort}/monitor.js"></script>\n`));
  console.log(chalk.gray(`  This will detect blank screens, console errors, and React issues.\n`));

  // Step 5: Start the user's dev server
  const isNextJs = detected.framework === 'Next.js';
  const hasInstrumentPackage = hasInstrumentInPackageJson(cwd);
  const devServerPort = detectDevServerPort(devCmd);

  console.log(chalk.bold(`  Starting: ${devCmd}\n`));
  console.log(chalk.gray('─'.repeat(60)));

  const child = startDevServer(devCmd, cwd, scanwarpPort, isNextJs, hasInstrumentPackage);

  const previousResults = store.previousResults;
  const baselines = store.baselines;
  // eslint-disable-next-line prefer-const
  let watcher: FSWatcher | undefined;

  // Handle cleanup
  const cleanup = () => {
    console.log(chalk.gray('\n\n  Shutting down...'));

    if (watcher) {
      watcher.close();
    }
    if (child && !child.killed) {
      child.kill('SIGTERM');
    }
    scanwarpServer.close();

    printSessionSummary(store);
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  child.on('exit', (code) => {
    console.log(chalk.gray(`\n  Dev server exited with code ${code}`));
    if (watcher) watcher.close();
    scanwarpServer.close();
    printSessionSummary(store);
    process.exit(code || 0);
  });

  // Step 6: Wait for dev server to be ready, then crawl routes
  if (devServerPort && (routes.pages.length > 0 || routes.apiRoutes.length > 0)) {
    await waitForServer(devServerPort, 30_000).then(async (ready) => {
      if (ready) {
        console.log(chalk.gray('\n─'.repeat(60)));
        console.log(chalk.bold.cyan('\n  Initial route check\n'));
        const initialResults = await crawlRoutes(routes, devServerPort, store.schemaTracker);

        for (const r of initialResults) {
          previousResults.set(r.route, r);
          if (r.status > 0 && r.status < 400) {
            baselines.set(r.route, r.timeMs);
          }
        }

        console.log(chalk.gray('\n─'.repeat(60)));
        console.log('');
      }
    }).catch(() => {
      // Server didn't start in time — that's fine, skip crawl
    });
  }

  // Step 7: Start file watcher
  watcher = startFileWatcher(cwd, routes, routeFileMap, previousResults, baselines, store.schemaTracker, devServerPort);

  // Enable live request log
  store.liveLogEnabled = true;
  console.log(chalk.bold.cyan('  Live request log\n'));
}

// ─── Dev command detection ───

function detectDevCommand(detected: DetectedProject, cwd: string): string {
  const pkgPath = path.join(cwd, 'package.json');
  let scripts: Record<string, string> = {};

  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      scripts = pkg.scripts || {};
    } catch {
      // ignore
    }
  }

  if (detected.framework === 'Next.js') {
    return scripts['dev'] ? 'npm run dev' : 'npx next dev';
  }

  if (detected.framework === 'Remix') {
    return scripts['dev'] ? 'npm run dev' : 'npx remix dev';
  }

  const viteFws = ['React', 'Vue', 'SvelteKit', 'Astro'];
  if (detected.framework && viteFws.includes(detected.framework)) {
    return scripts['dev'] ? 'npm run dev' : 'npx vite dev';
  }

  if (scripts['dev']) {
    return 'npm run dev';
  }

  if (scripts['start']) {
    return 'npm start';
  }

  return 'npm run dev';
}

function detectDevServerPort(devCmd: string): number {
  const portMatch = devCmd.match(/(?:-p|--port)\s+(\d+)/);
  if (portMatch) {
    return parseInt(portMatch[1]);
  }

  if (devCmd.includes('next')) return 3000;
  if (devCmd.includes('vite')) return 5173;
  if (devCmd.includes('remix')) return 5173;
  if (devCmd.includes('astro')) return 4321;

  return 3000;
}

// ─── Child process management ───

function startDevServer(
  devCmd: string,
  cwd: string,
  scanwarpPort: number,
  isNextJs: boolean,
  hasInstrumentPackage: boolean,
): ChildProcess {
  const [cmd, ...args] = parseCommand(devCmd);

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    SCANWARP_SERVER: `http://localhost:${scanwarpPort}`,
    SCANWARP_PROJECT_ID: 'local-dev',
    SCANWARP_SERVICE_NAME: 'dev',
  };

  if (!isNextJs && hasInstrumentPackage) {
    const existingNodeOpts = process.env.NODE_OPTIONS || '';
    env.NODE_OPTIONS = `--require @scanwarp/instrument ${existingNodeOpts}`.trim();
  }

  const child = spawn(cmd, args, {
    cwd,
    env,
    stdio: ['inherit', 'inherit', 'inherit'],
    shell: true,
  });

  return child;
}

function parseCommand(cmd: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote: string | null = null;

  for (const ch of cmd) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ' ') {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);

  return parts;
}

// ─── Server readiness check ───

async function waitForServer(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  const spinner = ora('Waiting for dev server to be ready...').start();

  while (Date.now() - start < timeoutMs) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(`http://localhost:${port}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok || response.status < 500) {
        spinner.succeed(`Dev server ready on port ${port}`);
        return true;
      }
    } catch {
      // Not ready yet
    }

    await sleep(500);
  }

  spinner.warn('Dev server did not respond in time — skipping route check');
  return false;
}

// ─── Utilities ───

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findAvailablePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(preferred, '127.0.0.1', () => {
      server.close(() => resolve(preferred));
    });
    server.on('error', () => {
      const server2 = createServer();
      server2.listen(0, '127.0.0.1', () => {
        const addr = server2.address();
        const port = typeof addr === 'object' && addr ? addr.port : preferred + 1;
        server2.close(() => resolve(port));
      });
    });
  });
}
