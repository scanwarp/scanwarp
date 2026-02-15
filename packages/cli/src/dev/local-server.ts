import chalk from 'chalk';
import { createServer, type Server } from 'http';
import { AnalysisEngine } from './analysis-engine.js';
import { SchemaTracker } from './analyzers/schema-drift.js';
import { BROWSER_MONITOR_SCRIPT } from './browser-monitor-script.js';
import type { DiscoveredRoutes } from './route-discovery.js';
import type { RouteCheckResult } from './route-checker.js';

export interface StoredSpan {
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

interface BrowserError {
  type: string;
  message: string;
  stack?: string;
  timestamp: number;
  url?: string;
  userAgent?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  html?: string;
}

export interface MemoryStore {
  spans: StoredSpan[];
  events: StoredEvent[];
  browserErrors: BrowserError[];
  liveLogEnabled: boolean;
  analysisEngine: AnalysisEngine;
  routes: DiscoveredRoutes;
  previousResults: Map<string, RouteCheckResult>;
  baselines: Map<string, number>;
  schemaTracker: SchemaTracker;
  startedAt: number;
}

const SPAN_KIND_MAP: Record<number, string> = {
  0: 'UNSPECIFIED', 1: 'INTERNAL', 2: 'SERVER', 3: 'CLIENT', 4: 'PRODUCER', 5: 'CONSUMER',
};

const STATUS_CODE_MAP: Record<number, string> = {
  0: 'UNSET', 1: 'OK', 2: 'ERROR',
};

export async function startLocalServer(
  port: number
): Promise<{ server: Server; store: MemoryStore }> {
  const store: MemoryStore = {
    spans: [],
    events: [],
    browserErrors: [],
    liveLogEnabled: false,
    analysisEngine: new AnalysisEngine(),
    routes: { pages: [], apiRoutes: [] },
    previousResults: new Map(),
    baselines: new Map(),
    schemaTracker: new SchemaTracker(),
    startedAt: Date.now(),
  };

  const server = createServer((req, res) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
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
        if (req.method === 'POST' && req.url === '/v1/traces') {
          handleTraceIngest(body, store);
          res.writeHead(200);
          res.end(JSON.stringify({ partialSuccess: {} }));
          return;
        }

        if (req.method === 'POST' && req.url === '/v1/metrics') {
          res.writeHead(200);
          res.end(JSON.stringify({ partialSuccess: {} }));
          return;
        }

        if (req.method === 'POST' && req.url === '/dev/errors') {
          handleBrowserError(body, store, res);
          return;
        }

        if (req.method === 'GET' && req.url === '/monitor.js') {
          const monitorScript = BROWSER_MONITOR_SCRIPT.replace(
            '__SCANWARP_SERVER__',
            `'http://localhost:${port}'`
          );
          res.setHeader('Content-Type', 'application/javascript');
          res.writeHead(200);
          res.end(monitorScript);
          return;
        }

        if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        // Data API routes
        if (req.method === 'GET') {
          if (handleDataApi(req.url || '', store, res)) return;
        }

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

function handleBrowserError(body: string, store: MemoryStore, res: import('http').ServerResponse) {
  try {
    const data = JSON.parse(body);
    const error: BrowserError = {
      type: data.error?.type || 'unknown',
      message: data.error?.message || 'No message',
      stack: data.error?.stack,
      timestamp: data.error?.timestamp || Date.now(),
      url: data.url,
      userAgent: data.userAgent,
      filename: data.error?.filename,
      lineno: data.error?.lineno,
      colno: data.error?.colno,
      html: data.error?.html,
    };

    store.browserErrors.push(error);
    if (store.browserErrors.length > 100) {
      store.browserErrors.shift();
    }

    if (error.type === 'blank_screen') {
      console.log(chalk.red('\n🚨 [Browser] Blank screen detected!'));
      console.log(chalk.yellow(`   URL: ${error.url}`));
    } else {
      console.log(chalk.red(`\n🚨 [Browser] ${error.type}: ${error.message}`));
      if (error.filename) {
        console.log(chalk.gray(`   ${error.filename}:${error.lineno}:${error.colno}`));
      }
    }

    res.writeHead(200);
    res.end(JSON.stringify({ success: true }));
  } catch (e) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'Invalid request' }));
  }
}

function handleDataApi(url: string, store: MemoryStore, res: import('http').ServerResponse): boolean {
  if (url === '/api/status') {
    const traceIds = new Set(store.spans.map((s) => s.trace_id));
    const uptimeMs = Date.now() - store.startedAt;
    const totalRoutes = store.routes.pages.length + store.routes.apiRoutes.length;
    res.writeHead(200);
    res.end(JSON.stringify({
      uptime_ms: uptimeMs,
      total_routes: totalRoutes,
      pages: store.routes.pages.length,
      api_routes: store.routes.apiRoutes.length,
      total_spans: store.spans.length,
      total_traces: traceIds.size,
      active_issues: store.analysisEngine.activeIssueCount,
      error_count: store.events.filter((e) => e.type === 'trace_error').length,
      schema_baselines: store.schemaTracker.getBaselineCount(),
    }));
    return true;
  }

  if (url === '/api/issues') {
    const issues = store.analysisEngine.getActiveIssues();
    res.writeHead(200);
    res.end(JSON.stringify({ issues }));
    return true;
  }

  if (url === '/api/browser-errors') {
    res.writeHead(200);
    res.end(JSON.stringify({
      errors: store.browserErrors.slice(-20),
      total: store.browserErrors.length,
    }));
    return true;
  }

  if (url === '/api/routes') {
    const allRoutes = [
      ...store.routes.pages.map((r) => ({ path: r, type: 'page' as const })),
      ...store.routes.apiRoutes.map((r) => ({ path: r, type: 'api' as const })),
    ];
    const routeData = allRoutes.map((route) => {
      const lastCheck = store.previousResults.get(route.path);
      const baseline = store.baselines.get(route.path);
      let status: 'healthy' | 'error' | 'slow' | 'unknown' = 'unknown';
      if (lastCheck) {
        if (lastCheck.status > 0 && lastCheck.status < 400) {
          status = 'healthy';
          if (baseline && lastCheck.timeMs > 500 && lastCheck.timeMs > baseline * 3) {
            status = 'slow';
          }
        } else {
          status = 'error';
        }
      }
      return {
        path: route.path,
        type: route.type,
        status,
        last_status_code: lastCheck?.status ?? null,
        last_time_ms: lastCheck?.timeMs ?? null,
        baseline_ms: baseline ?? null,
        error_text: lastCheck?.errorText ?? null,
      };
    });
    res.writeHead(200);
    res.end(JSON.stringify({ routes: routeData }));
    return true;
  }

  if (url === '/api/slow-routes') {
    const slowRoutes: Array<Record<string, unknown>> = [];
    for (const [route, baseline] of store.baselines) {
      const lastCheck = store.previousResults.get(route);
      if (!lastCheck || lastCheck.status === 0 || lastCheck.status >= 400) continue;
      if (lastCheck.timeMs > 500 && lastCheck.timeMs > baseline * 3) {
        const routeSpans = store.spans.filter((s) => {
          const spanRoute = s.attributes['http.route'] || s.attributes['http.target'] || s.attributes['url.path'];
          return spanRoute === route && s.kind === 'SERVER';
        });
        let bottleneck: { name: string; duration_ms: number } | null = null;
        if (routeSpans.length > 0) {
          const latestTrace = routeSpans[routeSpans.length - 1];
          const traceSpans = store.spans
            .filter((s) => s.trace_id === latestTrace.trace_id && s.span_id !== latestTrace.span_id)
            .sort((a, b) => b.duration_ms - a.duration_ms);
          if (traceSpans.length > 0) {
            bottleneck = { name: traceSpans[0].operation_name, duration_ms: traceSpans[0].duration_ms };
          }
        }
        slowRoutes.push({
          path: route,
          current_ms: lastCheck.timeMs,
          baseline_ms: baseline,
          ratio: Math.round((lastCheck.timeMs / baseline) * 10) / 10,
          bottleneck,
        });
      }
    }
    res.writeHead(200);
    res.end(JSON.stringify({ slow_routes: slowRoutes }));
    return true;
  }

  if (url?.startsWith('/api/route-traces')) {
    const urlObj = new URL(url, 'http://localhost');
    const routePath = urlObj.searchParams.get('path') || '/';
    const limit = parseInt(urlObj.searchParams.get('limit') || '5');
    const serverSpans = store.spans
      .filter((s) => {
        const spanRoute = s.attributes['http.route'] || s.attributes['http.target'] || s.attributes['url.path'];
        return s.kind === 'SERVER' && spanRoute === routePath;
      })
      .sort((a, b) => b.start_time - a.start_time)
      .slice(0, limit);
    const traces = serverSpans.map((rootSpan) => {
      const traceSpans = store.spans
        .filter((s) => s.trace_id === rootSpan.trace_id)
        .sort((a, b) => a.start_time - b.start_time);
      return {
        trace_id: rootSpan.trace_id,
        method: rootSpan.attributes['http.method'] || rootSpan.attributes['http.request.method'] || '???',
        route: routePath,
        status_code: rootSpan.attributes['http.status_code'] || rootSpan.attributes['http.response.status_code'],
        duration_ms: rootSpan.duration_ms,
        timestamp: rootSpan.start_time,
        spans: traceSpans.map((s) => ({
          span_id: s.span_id,
          parent_span_id: s.parent_span_id,
          operation: s.operation_name,
          kind: s.kind,
          duration_ms: s.duration_ms,
          status: s.status_code,
          service: s.service_name,
          attributes: s.attributes,
        })),
      };
    });
    res.writeHead(200);
    res.end(JSON.stringify({ path: routePath, traces }));
    return true;
  }

  return false;
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

        if (store.liveLogEnabled && span.kind === 'SERVER') {
          printRequestLogLine(span);
        }

        if (statusCode === 'ERROR') {
          store.events.push({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: 'trace_error',
            source: 'otel',
            message: `Error in ${serviceName}: ${otlpSpan.name}${otlpSpan.status?.message ? ` — ${otlpSpan.status.message}` : ''}`,
            severity: 'high',
            created_at: new Date(),
          });

          if (!store.liveLogEnabled || span.kind !== 'SERVER') {
            console.log(
              chalk.red(`  ✗ Error: ${span.operation_name} (${durationMs}ms) — ${serviceName}`)
            );
            if (otlpSpan.status?.message) {
              console.log(chalk.gray(`    ${otlpSpan.status.message}`));
            }
          }
        }

        if (attributes['db.system'] && durationMs > 1000) {
          store.events.push({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: 'slow_query',
            source: 'otel',
            message: `Slow ${attributes['db.system']} query: ${otlpSpan.name} (${durationMs}ms)`,
            severity: 'medium',
            created_at: new Date(),
          });

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

  // Keep memory bounded
  if (store.spans.length > 5000) {
    store.spans = store.spans.slice(-5000);
  }
  if (store.events.length > 1000) {
    store.events = store.events.slice(-1000);
  }

  // Run analysis on complete traces
  if (store.liveLogEnabled) {
    const newTraceIds = new Set<string>();
    for (const resourceSpan of payload.resourceSpans) {
      for (const scopeSpan of resourceSpan.scopeSpans || []) {
        for (const otlpSpan of scopeSpan.spans || []) {
          newTraceIds.add(otlpSpan.traceId);
        }
      }
    }

    for (const traceId of newTraceIds) {
      const traceSpans = store.spans.filter((s) => s.trace_id === traceId);
      store.analysisEngine.analyzeTrace(traceSpans);
    }
  }
}

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

  let errorSuffix = '';
  if (isError) {
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

export function printSessionSummary(store: MemoryStore) {
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

  const analysis = store.analysisEngine.getSummary();
  if (analysis.total > 0) {
    console.log('');
    console.log(chalk.bold('  Analysis:'));
    if (analysis.active > 0) {
      console.log(chalk.yellow(`  Active issues: ${analysis.active}`));
    }
    if (analysis.resolved > 0) {
      console.log(chalk.green(`  Resolved:      ${analysis.resolved}`));
    }
    for (const [rule, count] of analysis.byRule) {
      console.log(chalk.gray(`    ${rule}: ${count}`));
    }
  }

  console.log('');
}
