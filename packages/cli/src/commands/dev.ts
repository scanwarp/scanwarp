import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { createServer, type Server } from 'http';
import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
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
  /** Set to true once the initial crawl is done and we should print the live request log */
  liveLogEnabled: boolean;
}

/** Stored result from checking a single route */
interface RouteCheckResult {
  route: string;
  method: string;
  status: number;
  timeMs: number;
  errorText?: string;
}

/** Maps a route path to its source file (for file-change → route mapping) */
interface RouteFileMap {
  /** file path → route path */
  fileToRoute: Map<string, string>;
  /** file path → 'page' | 'api' */
  fileToType: Map<string, 'page' | 'api'>;
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
  console.log(
    chalk.green(`  ScanWarp local server: http://localhost:${scanwarpPort}\n`)
  );

  // Step 5: Start the user's dev server
  const isNextJs = detected.framework === 'Next.js';
  const devServerPort = detectDevServerPort(devCmd);

  console.log(chalk.bold(`  Starting: ${devCmd}\n`));
  console.log(chalk.gray('─'.repeat(60)));

  const child = startDevServer(devCmd, cwd, scanwarpPort, isNextJs);

  // Track previous route check results for comparison and baselines
  const previousResults = new Map<string, RouteCheckResult>();
  /** First successful response time per route — used to detect slow regressions */
  const baselines = new Map<string, number>();
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

    // Print session summary
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
        const initialResults = await crawlRoutes(routes, devServerPort);

        // Store initial results as both previous and baseline
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
  watcher = startFileWatcher(cwd, routes, routeFileMap, previousResults, baselines, devServerPort);

  // Enable live request log
  store.liveLogEnabled = true;
  console.log(chalk.bold.cyan('  Live request log\n'));
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

function discoverRoutes(detected: DetectedProject, cwd: string, routeFileMap?: RouteFileMap): DiscoveredRoutes {
  const pages: string[] = [];
  const apiRoutes: string[] = [];

  if (detected.framework === 'Next.js') {
    // Next.js App Router
    const appDir = fs.existsSync(path.join(cwd, 'src', 'app'))
      ? path.join(cwd, 'src', 'app')
      : path.join(cwd, 'app');

    if (fs.existsSync(appDir)) {
      walkNextAppDir(appDir, appDir, pages, apiRoutes, routeFileMap);
    }

    // Next.js Pages Router
    const pagesDir = fs.existsSync(path.join(cwd, 'src', 'pages'))
      ? path.join(cwd, 'src', 'pages')
      : path.join(cwd, 'pages');

    if (fs.existsSync(pagesDir)) {
      walkNextPagesDir(pagesDir, pagesDir, pages, apiRoutes, routeFileMap);
    }
  }

  return { pages, apiRoutes };
}

function walkNextAppDir(
  dir: string,
  baseDir: string,
  pages: string[],
  apiRoutes: string[],
  routeFileMap?: RouteFileMap,
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
      walkNextAppDir(fullPath, baseDir, pages, apiRoutes, routeFileMap);
    } else if (entry.isFile()) {
      const relativePath = path.relative(baseDir, dir);
      const route = '/' + relativePath.replace(/\\/g, '/');
      const normalizedRoute = route === '/.' ? '/' : route;

      if (entry.name.match(/^route\.(ts|tsx|js|jsx)$/)) {
        apiRoutes.push(normalizedRoute);
        if (routeFileMap) {
          routeFileMap.fileToRoute.set(fullPath, normalizedRoute);
          routeFileMap.fileToType.set(fullPath, 'api');
        }
      } else if (entry.name.match(/^page\.(ts|tsx|js|jsx)$/)) {
        pages.push(normalizedRoute);
        if (routeFileMap) {
          routeFileMap.fileToRoute.set(fullPath, normalizedRoute);
          routeFileMap.fileToType.set(fullPath, 'page');
        }
      }
    }
  }
}

function walkNextPagesDir(
  dir: string,
  baseDir: string,
  pages: string[],
  apiRoutes: string[],
  routeFileMap?: RouteFileMap,
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
      walkNextPagesDir(fullPath, baseDir, pages, apiRoutes, routeFileMap);
    } else if (entry.isFile() && entry.name.match(/\.(ts|tsx|js|jsx)$/)) {
      const relativePath = path.relative(baseDir, fullPath);
      const routePath = '/' + relativePath
        .replace(/\\/g, '/')
        .replace(/\.(ts|tsx|js|jsx)$/, '')
        .replace(/\/index$/, '')
        || '/';

      const isApi = relativePath.startsWith('api/') || relativePath.startsWith('api\\');
      if (isApi) {
        apiRoutes.push(routePath);
      } else {
        pages.push(routePath);
      }

      if (routeFileMap) {
        routeFileMap.fileToRoute.set(fullPath, routePath);
        routeFileMap.fileToType.set(fullPath, isApi ? 'api' : 'page');
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
    liveLogEnabled: false,
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

        // Live request log — print a line for each SERVER span (incoming HTTP request)
        if (store.liveLogEnabled && span.kind === 'SERVER') {
          printRequestLogLine(span);
        }

        // Track errors (non-SERVER spans that are errors, or SERVER errors already printed above)
        if (statusCode === 'ERROR') {
          const event: StoredEvent = {
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: 'trace_error',
            source: 'otel',
            message: `Error in ${serviceName}: ${otlpSpan.name}${otlpSpan.status?.message ? ` — ${otlpSpan.status.message}` : ''}`,
            severity: 'high',
            created_at: new Date(),
          };
          store.events.push(event);

          // Print non-SERVER errors separately (SERVER errors show in the request log)
          if (!store.liveLogEnabled || span.kind !== 'SERVER') {
            console.log(
              chalk.red(`  ✗ Error: ${span.operation_name} (${durationMs}ms) — ${serviceName}`)
            );
            if (otlpSpan.status?.message) {
              console.log(chalk.gray(`    ${otlpSpan.status.message}`));
            }
          }
        }

        // Track slow queries
        if (attributes['db.system'] && durationMs > 1000) {
          const event: StoredEvent = {
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: 'slow_query',
            source: 'otel',
            message: `Slow ${attributes['db.system']} query: ${otlpSpan.name} (${durationMs}ms)`,
            severity: 'medium',
            created_at: new Date(),
          };
          store.events.push(event);

          if (store.liveLogEnabled) {
            console.log(
              chalk.yellow(`           ⚠ slow query: ${attributes['db.system']}: ${otlpSpan.name} (${durationMs}ms)`)
            );
          } else {
            console.log(
              chalk.yellow(`  ⚠ Slow query: ${attributes['db.system']}: ${otlpSpan.name} (${durationMs}ms)`)
            );
          }
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

/**
 * Print a single request log line in the format:
 *   14:02:01  ✓  GET /api/products   34ms
 *   14:02:05  ✗  POST /api/checkout   0ms  TypeError: Cannot read...
 */
function printRequestLogLine(span: StoredSpan) {
  const now = new Date(span.start_time);
  const time = chalk.gray(
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
  );

  const attrs = span.attributes;
  const method = String(attrs['http.method'] || attrs['http.request.method'] || '???');
  const route = String(
    attrs['http.route'] || attrs['http.target'] || attrs['url.path'] || span.operation_name
  );
  const httpStatus = attrs['http.status_code'] || attrs['http.response.status_code'];

  const isError =
    span.status_code === 'ERROR' ||
    (typeof httpStatus === 'number' && httpStatus >= 400);

  const icon = isError ? chalk.red('✗') : chalk.green('✓');

  const label = `${method} ${route}`;
  const durationStr = `${span.duration_ms}ms`.padStart(6);
  const durationColor = span.duration_ms > 1000 ? chalk.yellow(durationStr) : chalk.white(durationStr);

  // Build error suffix
  let errorSuffix = '';
  if (isError) {
    // Try to get an error message from span events
    const exceptionEvent = span.events.find((e) => e.name === 'exception');
    const exceptionMsg = exceptionEvent?.attributes?.['exception.message'];
    if (typeof exceptionMsg === 'string') {
      const truncated = exceptionMsg.length > 50 ? exceptionMsg.substring(0, 50) + '...' : exceptionMsg;
      errorSuffix = `  ${chalk.red(truncated)}`;
    } else if (span.status_message) {
      const truncated = span.status_message.length > 50 ? span.status_message.substring(0, 50) + '...' : span.status_message;
      errorSuffix = `  ${chalk.red(truncated)}`;
    } else if (typeof httpStatus === 'number') {
      errorSuffix = `  ${chalk.red(String(httpStatus))}`;
    }
  }

  console.log(` ${time}  ${icon}  ${label.padEnd(28)} ${durationColor}${errorSuffix}`);
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

async function crawlRoutes(routes: DiscoveredRoutes, port: number): Promise<RouteCheckResult[]> {
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
    return [];
  }

  console.log(chalk.bold('  Initial scan:\n'));

  const checkResults = await checkRoutes(staticRoutes, port);
  printRouteResults(checkResults);

  return checkResults;
}

/** Hit each route with GET and return results */
async function checkRoutes(routes: string[], port: number): Promise<RouteCheckResult[]> {
  const results: RouteCheckResult[] = [];

  for (const route of routes) {
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

      // Try to extract error text from non-ok responses
      let errorText: string | undefined;
      if (response.status >= 400) {
        try {
          const text = await response.text();
          try {
            const json = JSON.parse(text);
            errorText = json.error || json.message || undefined;
          } catch {
            const firstLine = text.split('\n')[0];
            if (firstLine && firstLine.length > 0) {
              errorText = firstLine.length > 60 ? firstLine.substring(0, 60) + '...' : firstLine;
            }
          }
        } catch {
          // ignore
        }
      }

      results.push({ route, method: 'GET', status: response.status, timeMs, errorText });
    } catch (err) {
      results.push({
        route,
        method: 'GET',
        status: 0,
        timeMs: 0,
        errorText: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

interface PrintRouteOptions {
  previousResults?: Map<string, RouteCheckResult>;
  baselines?: Map<string, number>;
  /** When true, only print routes with changes/errors/slow regressions */
  quiet?: boolean;
}

/** Print route check results with aligned columns */
function printRouteResults(results: RouteCheckResult[], opts: PrintRouteOptions = {}) {
  if (results.length === 0) return;

  const { previousResults, baselines, quiet } = opts;
  const maxRouteLen = Math.max(...results.map((r) => `${r.method} ${r.route}`.length));

  let printedCount = 0;
  let suppressedOkCount = 0;

  for (const r of results) {
    const isOk = r.status > 0 && r.status < 400;
    const label = `${r.method} ${r.route}`;
    const padded = label.padEnd(maxRouteLen + 2);
    const timeStr = `${r.timeMs}ms`.padStart(6);
    const timeColor = r.timeMs > 1000 ? chalk.yellow(timeStr) : chalk.gray(timeStr);

    const statusStr = r.status === 0 ? '' : (isOk ? '' : `  ${chalk.red(String(r.status))}`);
    const errStr = (!isOk && r.errorText) ? `  ${chalk.gray(r.errorText)}` : '';

    // Change indicator compared to previous results
    let changeIndicator = '';
    let hasChange = false;

    if (previousResults) {
      const prev = previousResults.get(r.route);
      if (prev) {
        const prevOk = prev.status > 0 && prev.status < 400;
        if (!prevOk && isOk) {
          changeIndicator = `  ${chalk.green('FIXED')}`;
          hasChange = true;
        } else if (prevOk && !isOk) {
          changeIndicator = `  ${chalk.red('BROKE')}`;
          hasChange = true;
        } else if (prev.status !== r.status) {
          changeIndicator = `  ${chalk.yellow(`${prev.status}→${r.status}`)}`;
          hasChange = true;
        }
      } else {
        changeIndicator = `  ${chalk.cyan('NEW')}`;
        hasChange = true;
      }
    }

    // Slow regression detection: 3x baseline AND over 500ms
    let slowIndicator = '';
    if (isOk && baselines) {
      const baseline = baselines.get(r.route);
      if (baseline !== undefined && r.timeMs > 500 && r.timeMs > baseline * 3) {
        slowIndicator = `  ${chalk.yellow(`SLOW (baseline: ${baseline}ms)`)}`;
        hasChange = true;
      }
    }

    // In quiet mode, skip routes that are OK with no changes and no slow regression
    if (quiet && isOk && !hasChange) {
      suppressedOkCount++;
      continue;
    }

    const icon = isOk ? chalk.green('✓') : chalk.red('✗');
    console.log(`   ${icon} ${padded} ${timeColor}${statusStr}${errStr}${changeIndicator}${slowIndicator}`);
    printedCount++;
  }

  // Summary
  const okCount = results.filter((r) => r.status > 0 && r.status < 400).length;
  const errCount = results.filter((r) => r.status === 0 || r.status >= 400).length;
  const validResults = results.filter((r) => r.status > 0);
  const avgTime = validResults.length > 0
    ? Math.round(validResults.reduce((sum, r) => sum + r.timeMs, 0) / validResults.length)
    : 0;

  if (quiet && suppressedOkCount > 0 && printedCount > 0) {
    console.log(chalk.gray(`   ... (${suppressedOkCount} more OK)`));
  }

  // In quiet mode with nothing interesting, print a single line
  if (quiet && printedCount === 0) {
    console.log(chalk.gray(`   ✓ All ${okCount} routes OK (avg ${avgTime}ms)`));
    return;
  }

  console.log('');
  console.log(
    chalk.gray(
      `   ${okCount} ok, ${errCount} errors, avg ${avgTime}ms`
    )
  );
}

// ─── File watcher ───

function startFileWatcher(
  cwd: string,
  routes: DiscoveredRoutes,
  routeFileMap: RouteFileMap,
  previousResults: Map<string, RouteCheckResult>,
  baselines: Map<string, number>,
  devServerPort: number,
): FSWatcher {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFiles = new Set<string>();

  const watcher = chokidarWatch(
    ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs'],
    {
      cwd,
      ignored: ['**/node_modules/**', '**/.next/**', '**/.git/**', '**/dist/**', '**/build/**'],
      ignoreInitial: true,
    }
  );

  watcher.on('change', (relativePath) => {
    const fullPath = path.resolve(cwd, relativePath);
    pendingFiles.add(fullPath);

    // Debounce — wait 1 second after the last change
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const changedFiles = new Set(pendingFiles);
      pendingFiles = new Set();

      const affectedRoutes = resolveAffectedRoutes(changedFiles, routes, routeFileMap);
      if (affectedRoutes.length === 0) return;

      const fileNames = [...changedFiles].map((f) => path.relative(cwd, f)).join(', ');
      console.log('');
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.bold.cyan(`\n  File changed: ${chalk.white(fileNames)}\n`));
      console.log(chalk.bold(`  Re-checking ${affectedRoutes.length} route${affectedRoutes.length > 1 ? 's' : ''}...\n`));

      const newResults = await checkRoutes(affectedRoutes, devServerPort);
      printRouteResults(newResults, { previousResults, baselines, quiet: true });

      // Update previous results and baselines
      for (const r of newResults) {
        previousResults.set(r.route, r);
        // Set baseline on first success (don't overwrite existing baselines)
        if (r.status > 0 && r.status < 400 && !baselines.has(r.route)) {
          baselines.set(r.route, r.timeMs);
        }
      }

      console.log(chalk.gray('\n─'.repeat(60)));
      console.log('');
    }, 1000);
  });

  return watcher;
}

/** Map changed files to affected routes */
function resolveAffectedRoutes(
  changedFiles: Set<string>,
  routes: DiscoveredRoutes,
  routeFileMap: RouteFileMap,
): string[] {
  const affected = new Set<string>();
  let hasNonRouteFile = false;

  for (const file of changedFiles) {
    const route = routeFileMap.fileToRoute.get(file);
    if (route) {
      // Direct match — this file IS a route file
      affected.add(route);
    } else {
      // Not a known route file — could be a utility, component, etc.
      hasNonRouteFile = true;
    }
  }

  // For non-route files, re-check all API routes (they're more likely to be affected by shared code)
  if (hasNonRouteFile) {
    const staticApiRoutes = routes.apiRoutes.filter((r) => !r.includes('['));
    for (const route of staticApiRoutes) {
      affected.add(route);
    }
  }

  return [...affected];
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
