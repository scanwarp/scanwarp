import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { createServer, type Server } from 'http';
import { detectProject, type DetectedProject } from '../detector.js';

interface DevOptions {
  command?: string;
  port?: number;
}

// ─── In-memory storage for the local ScanWarp server ───

interface StoredSpan {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  service_name: string;
  operation_name: string;
  kind: string;
  start_time: number;
  duration_ms: number;
  status_code: string;
  status_message: string | null;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; attributes?: Record<string, unknown> }>;
}

interface StoredEvent {
  id: string;
  type: string;
  source: string;
  message: string;
  severity: string;
  created_at: Date;
}

interface MemoryStore {
  spans: StoredSpan[];
  events: StoredEvent[];
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

  // Step 2: Determine the dev command
  const devCmd = options.command || detectDevCommand(detected, cwd);
  console.log(chalk.gray(`  Dev command: ${devCmd}\n`));

  // Step 3: Discover routes
  const routes = discoverRoutes(detected, cwd);
  if (routes.pages.length > 0 || routes.apiRoutes.length > 0) {
    console.log(
      chalk.green(`  Found ${routes.pages.length} pages, ${routes.apiRoutes.length} API routes`)
    );
  }

  // Step 4: Start in-memory ScanWarp server
  const scanwarpPort = options.port || (await findAvailablePort(3456));
  const { server: scanwarpServer, store } = await startLocalServer(scanwarpPort);
  console.log(
    chalk.green(`  ScanWarp local server: http://localhost:${scanwarpPort}\n`)
  );

  // Step 5: Start the user's dev server
  const isNextJs = detected.framework === 'Next.js';
  const devServerPort = detectDevServerPort(devCmd);

  console.log(chalk.bold(`  Starting: ${devCmd}\n`));
  console.log(chalk.gray('─'.repeat(60)));

  const child = startDevServer(devCmd, cwd, scanwarpPort, isNextJs);

  // Handle cleanup
  const cleanup = () => {
    console.log(chalk.gray('\n\n  Shutting down...'));

    if (child && !child.killed) {
      child.kill('SIGTERM');
    }
    scanwarpServer.close();

    // Print session summary
    printSessionSummary(store);
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  child.on('exit', (code) => {
    console.log(chalk.gray(`\n  Dev server exited with code ${code}`));
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
        await crawlRoutes(routes, devServerPort);
        console.log(chalk.gray('\n─'.repeat(60)));
        console.log('');
      }
    }).catch(() => {
      // Server didn't start in time — that's fine, skip crawl
    });
  }
}

// ─── Dev command detection ───

function detectDevCommand(detected: DetectedProject, cwd: string): string {
  // Check package.json scripts
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

  // Framework-specific defaults
  if (detected.framework === 'Next.js') {
    return scripts['dev'] ? 'npm run dev' : 'npx next dev';
  }

  if (detected.framework === 'Remix') {
    return scripts['dev'] ? 'npm run dev' : 'npx remix dev';
  }

  // Vite-based frameworks
  const viteFws = ['React', 'Vue', 'SvelteKit', 'Astro'];
  if (detected.framework && viteFws.includes(detected.framework)) {
    return scripts['dev'] ? 'npm run dev' : 'npx vite dev';
  }

  // Generic — use "dev" script if available
  if (scripts['dev']) {
    return 'npm run dev';
  }

  // Fallback — look for common entry points
  if (scripts['start']) {
    return 'npm start';
  }

  return 'npm run dev';
}

function detectDevServerPort(devCmd: string): number {
  // Try to extract port from the command
  const portMatch = devCmd.match(/(?:-p|--port)\s+(\d+)/);
  if (portMatch) {
    return parseInt(portMatch[1]);
  }

  // Default ports by framework
  if (devCmd.includes('next')) return 3000;
  if (devCmd.includes('vite')) return 5173;
  if (devCmd.includes('remix')) return 5173;
  if (devCmd.includes('astro')) return 4321;

  return 3000;
}

// ─── Route discovery ───

interface DiscoveredRoutes {
  pages: string[];
  apiRoutes: string[];
}

function discoverRoutes(detected: DetectedProject, cwd: string): DiscoveredRoutes {
  const pages: string[] = [];
  const apiRoutes: string[] = [];

  if (detected.framework === 'Next.js') {
    // Next.js App Router
    const appDir = fs.existsSync(path.join(cwd, 'src', 'app'))
      ? path.join(cwd, 'src', 'app')
      : path.join(cwd, 'app');

    if (fs.existsSync(appDir)) {
      walkNextAppDir(appDir, appDir, pages, apiRoutes);
    }

    // Next.js Pages Router
    const pagesDir = fs.existsSync(path.join(cwd, 'src', 'pages'))
      ? path.join(cwd, 'src', 'pages')
      : path.join(cwd, 'pages');

    if (fs.existsSync(pagesDir)) {
      walkNextPagesDir(pagesDir, pagesDir, pages, apiRoutes);
    }
  }

  return { pages, apiRoutes };
}

function walkNextAppDir(
  dir: string,
  baseDir: string,
  pages: string[],
  apiRoutes: string[]
) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walkNextAppDir(fullPath, baseDir, pages, apiRoutes);
    } else if (entry.isFile()) {
      const relativePath = path.relative(baseDir, dir);
      const route = '/' + relativePath.replace(/\\/g, '/');

      if (entry.name.match(/^route\.(ts|tsx|js|jsx)$/)) {
        apiRoutes.push(route === '/.' ? '/' : route);
      } else if (entry.name.match(/^page\.(ts|tsx|js|jsx)$/)) {
        pages.push(route === '/.' ? '/' : route);
      }
    }
  }
}

function walkNextPagesDir(
  dir: string,
  baseDir: string,
  pages: string[],
  apiRoutes: string[]
) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_') || entry.name === 'node_modules') continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walkNextPagesDir(fullPath, baseDir, pages, apiRoutes);
    } else if (entry.isFile() && entry.name.match(/\.(ts|tsx|js|jsx)$/)) {
      const relativePath = path.relative(baseDir, fullPath);
      const routePath = '/' + relativePath
        .replace(/\\/g, '/')
        .replace(/\.(ts|tsx|js|jsx)$/, '')
        .replace(/\/index$/, '')
        || '/';

      if (relativePath.startsWith('api/') || relativePath.startsWith('api\\')) {
        apiRoutes.push(routePath);
      } else {
        pages.push(routePath);
      }
    }
  }
}

// ─── In-memory ScanWarp local server ───

const SPAN_KIND_MAP: Record<number, string> = {
  0: 'UNSPECIFIED',
  1: 'INTERNAL',
  2: 'SERVER',
  3: 'CLIENT',
  4: 'PRODUCER',
  5: 'CONSUMER',
};

const STATUS_CODE_MAP: Record<number, string> = {
  0: 'UNSET',
  1: 'OK',
  2: 'ERROR',
};

async function startLocalServer(
  port: number
): Promise<{ server: Server; store: MemoryStore }> {
  const store: MemoryStore = {
    spans: [],
    events: [],
  };

  const server = createServer((req, res) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-scanwarp-project-id');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      res.setHeader('Content-Type', 'application/json');

      try {
        // POST /v1/traces
        if (req.method === 'POST' && req.url === '/v1/traces') {
          handleTraceIngest(body, store);
          res.writeHead(200);
          res.end(JSON.stringify({ partialSuccess: {} }));
          return;
        }

        // POST /v1/metrics
        if (req.method === 'POST' && req.url === '/v1/metrics') {
          res.writeHead(200);
          res.end(JSON.stringify({ partialSuccess: {} }));
          return;
        }

        // GET /health
        if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        // Catch-all for unknown routes
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, store });
    });
    server.on('error', reject);
  });
}

function handleTraceIngest(body: string, store: MemoryStore) {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return;
  }

  if (!payload.resourceSpans) return;

  let newErrors = 0;
  let newSlowQueries = 0;

  for (const resourceSpan of payload.resourceSpans) {
    const serviceName = extractServiceName(resourceSpan.resource) || 'unknown';

    for (const scopeSpan of resourceSpan.scopeSpans || []) {
      for (const otlpSpan of scopeSpan.spans || []) {
        const startTimeNano = BigInt(otlpSpan.startTimeUnixNano);
        const endTimeNano = BigInt(otlpSpan.endTimeUnixNano);
        const startTimeMs = Number(startTimeNano / BigInt(1_000_000));
        const durationMs = Number((endTimeNano - startTimeNano) / BigInt(1_000_000));
        const statusCode = STATUS_CODE_MAP[otlpSpan.status?.code ?? 0] || 'UNSET';
        const attributes = flattenAttributes(otlpSpan.attributes);
        const spanEvents = (otlpSpan.events || []).map((e: { name: string; attributes?: Array<{ key: string; value: Record<string, unknown> }> }) => ({
          name: e.name,
          attributes: flattenAttributes(e.attributes),
        }));

        const span: StoredSpan = {
          trace_id: otlpSpan.traceId,
          span_id: otlpSpan.spanId,
          parent_span_id: otlpSpan.parentSpanId || null,
          service_name: serviceName,
          operation_name: otlpSpan.name,
          kind: SPAN_KIND_MAP[otlpSpan.kind] || 'UNSPECIFIED',
          start_time: startTimeMs,
          duration_ms: durationMs,
          status_code: statusCode,
          status_message: otlpSpan.status?.message || null,
          attributes,
          events: spanEvents,
        };

        store.spans.push(span);

        // Track errors
        if (statusCode === 'ERROR') {
          newErrors++;
          const event: StoredEvent = {
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: 'trace_error',
            source: 'otel',
            message: `Error in ${serviceName}: ${otlpSpan.name}${otlpSpan.status?.message ? ` — ${otlpSpan.status.message}` : ''}`,
            severity: 'high',
            created_at: new Date(),
          };
          store.events.push(event);

          // Print error to console in real time
          console.log(
            chalk.red(`  ✗ Error: ${span.operation_name} (${durationMs}ms) — ${serviceName}`)
          );
          if (otlpSpan.status?.message) {
            console.log(chalk.gray(`    ${otlpSpan.status.message}`));
          }
        }

        // Track slow queries
        if (attributes['db.system'] && durationMs > 1000) {
          newSlowQueries++;
          const event: StoredEvent = {
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: 'slow_query',
            source: 'otel',
            message: `Slow ${attributes['db.system']} query: ${otlpSpan.name} (${durationMs}ms)`,
            severity: 'medium',
            created_at: new Date(),
          };
          store.events.push(event);

          console.log(
            chalk.yellow(`  ⚠ Slow query: ${attributes['db.system']}: ${otlpSpan.name} (${durationMs}ms)`)
          );
        }
      }
    }
  }

  // Keep memory bounded — retain last 5000 spans
  if (store.spans.length > 5000) {
    store.spans = store.spans.slice(-5000);
  }
  if (store.events.length > 1000) {
    store.events = store.events.slice(-1000);
  }
}

function extractServiceName(resource?: { attributes?: Array<{ key: string; value: { stringValue?: string } }> }): string | undefined {
  if (!resource?.attributes) return undefined;
  for (const attr of resource.attributes) {
    if (attr.key === 'service.name') {
      return attr.value.stringValue;
    }
  }
  return undefined;
}

function flattenAttributes(attrs?: Array<{ key: string; value: Record<string, unknown> }>): Record<string, unknown> {
  if (!attrs) return {};
  const result: Record<string, unknown> = {};
  for (const attr of attrs) {
    const val = attr.value;
    if (val.stringValue !== undefined) result[attr.key] = val.stringValue;
    else if (val.intValue !== undefined) result[attr.key] = Number(val.intValue);
    else if (val.doubleValue !== undefined) result[attr.key] = val.doubleValue;
    else if (val.boolValue !== undefined) result[attr.key] = val.boolValue;
  }
  return result;
}

// ─── Child process management ───

function startDevServer(
  devCmd: string,
  cwd: string,
  scanwarpPort: number,
  isNextJs: boolean,
): ChildProcess {
  const [cmd, ...args] = parseCommand(devCmd);

  // Build env vars
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    SCANWARP_SERVER: `http://localhost:${scanwarpPort}`,
    SCANWARP_PROJECT_ID: 'local-dev',
    SCANWARP_SERVICE_NAME: 'dev',
  };

  // For non-Next.js, inject NODE_OPTIONS to auto-load instrumentation
  if (!isNextJs) {
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
  // Simple command parsing — split on spaces but respect quotes
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

// ─── Route crawling ───

async function crawlRoutes(routes: DiscoveredRoutes, port: number) {
  const allGetRoutes = [
    ...routes.pages,
    ...routes.apiRoutes.filter((r) => !r.includes('[') || !r.includes(']')),
  ];

  // Filter out dynamic routes (contain [...] or [param]) since we can't crawl them
  const staticRoutes = allGetRoutes.filter(
    (r) => !r.includes('[')
  );

  if (staticRoutes.length === 0) {
    console.log(chalk.gray('  No static routes to check (all routes are dynamic)\n'));
    return;
  }

  const results: Array<{ route: string; status: number; timeMs: number }> = [];
  const errors: Array<{ route: string; error: string }> = [];

  for (const route of staticRoutes) {
    try {
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`http://localhost:${port}${route}`, {
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);

      const timeMs = Date.now() - start;
      results.push({ route, status: response.status, timeMs });
    } catch (err) {
      errors.push({
        route,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Print results
  for (const r of results) {
    const statusColor = r.status < 300
      ? chalk.green
      : r.status < 400
        ? chalk.yellow
        : chalk.red;
    const timeColor = r.timeMs > 1000
      ? chalk.yellow
      : chalk.gray;

    console.log(
      `  ${statusColor(String(r.status))} ${r.route} ${timeColor(`${r.timeMs}ms`)}`
    );
  }

  for (const e of errors) {
    console.log(`  ${chalk.red('ERR')} ${e.route} ${chalk.gray(e.error)}`);
  }

  // Summary
  const okCount = results.filter((r) => r.status < 400).length;
  const errCount = results.filter((r) => r.status >= 400).length + errors.length;
  const avgTime = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.timeMs, 0) / results.length)
    : 0;

  console.log('');
  console.log(
    chalk.gray(
      `  ${okCount} ok, ${errCount} errors, avg ${avgTime}ms`
    )
  );
}

// ─── Session summary ───

function printSessionSummary(store: MemoryStore) {
  const totalSpans = store.spans.length;
  const errorEvents = store.events.filter((e) => e.type === 'trace_error');
  const slowQueries = store.events.filter((e) => e.type === 'slow_query');
  const traceIds = new Set(store.spans.map((s) => s.trace_id));

  console.log(chalk.bold.cyan('\n  Session Summary\n'));
  console.log(chalk.gray(`  Traces: ${traceIds.size}`));
  console.log(chalk.gray(`  Spans:  ${totalSpans}`));

  if (errorEvents.length > 0) {
    console.log(chalk.red(`  Errors: ${errorEvents.length}`));
  } else {
    console.log(chalk.green(`  Errors: 0`));
  }

  if (slowQueries.length > 0) {
    console.log(chalk.yellow(`  Slow queries: ${slowQueries.length}`));
  }

  console.log('');
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
      // Port in use — try next
      const server2 = createServer();
      server2.listen(0, '127.0.0.1', () => {
        const addr = server2.address();
        const port = typeof addr === 'object' && addr ? addr.port : preferred + 1;
        server2.close(() => resolve(port));
      });
    });
  });
}
