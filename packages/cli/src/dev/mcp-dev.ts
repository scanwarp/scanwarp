/**
 * MCP server for scanwarp dev mode.
 *
 * Connects to the running scanwarp dev instance via its local HTTP API
 * and exposes monitoring data to AI coding tools (Cursor, Claude Code).
 *
 * Transport: stdio (Cursor and Claude Code connect via command execution).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ─── HTTP client for the dev instance API ───

async function fetchDevApi(port: number, path: string): Promise<unknown> {
  const response = await fetch(`http://localhost:${port}${path}`);
  if (!response.ok) {
    throw new Error(`Dev API returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

// ─── Tool implementations ───

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

async function getDevStatus(port: number): Promise<string> {
  const data = await fetchDevApi(port, '/api/status') as {
    uptime_ms: number;
    total_routes: number;
    pages: number;
    api_routes: number;
    total_spans: number;
    total_traces: number;
    active_issues: number;
    error_count: number;
  };

  const lines: string[] = [];
  lines.push(`## Dev Mode Status\n`);
  lines.push(`**Uptime:** ${formatUptime(data.uptime_ms)}`);
  lines.push(`**Routes:** ${data.total_routes} total (${data.pages} pages, ${data.api_routes} API routes)`);
  lines.push(`**Traces:** ${data.total_traces} traces, ${data.total_spans} spans`);

  if (data.active_issues > 0) {
    lines.push(`**Issues:** ${data.active_issues} active issues detected`);
  } else {
    lines.push(`**Issues:** None detected`);
  }

  if (data.error_count > 0) {
    lines.push(`**Errors:** ${data.error_count} errors recorded`);
  }

  const health = data.active_issues === 0 && data.error_count === 0 ? 'Healthy' : 'Issues detected';
  lines.push(`\n**Overall:** ${health}`);

  return lines.join('\n');
}

async function getDevIssues(port: number): Promise<string> {
  const data = await fetchDevApi(port, '/api/issues') as {
    issues: Array<{
      severity: string;
      rule: string;
      message: string;
      detail?: string;
      suggestion?: string;
    }>;
  };

  if (data.issues.length === 0) {
    return 'No active issues detected. Your app is running clean.';
  }

  const lines: string[] = [];
  lines.push(`## Active Issues (${data.issues.length})\n`);

  for (let i = 0; i < data.issues.length; i++) {
    const issue = data.issues[i];
    const icon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';
    lines.push(`### ${i + 1}. ${icon} [${issue.severity.toUpperCase()}] ${issue.message}`);
    lines.push(`**Rule:** ${issue.rule}`);
    if (issue.detail) {
      lines.push(`**Detail:** ${issue.detail}`);
    }
    if (issue.suggestion) {
      lines.push(`**Suggestion:** ${issue.suggestion}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function getDevRoutes(port: number): Promise<string> {
  const data = await fetchDevApi(port, '/api/routes') as {
    routes: Array<{
      path: string;
      type: string;
      status: string;
      last_status_code: number | null;
      last_time_ms: number | null;
      baseline_ms: number | null;
      error_text: string | null;
    }>;
  };

  if (data.routes.length === 0) {
    return 'No routes discovered. Make sure your dev server is running.';
  }

  const lines: string[] = [];
  lines.push(`## Discovered Routes (${data.routes.length})\n`);

  const statusIcon: Record<string, string> = {
    healthy: '✅',
    error: '❌',
    slow: '⚠️',
    unknown: '❓',
  };

  // Group by type
  const pages = data.routes.filter((r) => r.type === 'page');
  const apiRoutes = data.routes.filter((r) => r.type === 'api');

  if (pages.length > 0) {
    lines.push(`### Pages (${pages.length})\n`);
    lines.push('| Route | Status | Response Time | Baseline |');
    lines.push('|-------|--------|--------------|----------|');
    for (const r of pages) {
      const icon = statusIcon[r.status] || '❓';
      const time = r.last_time_ms !== null ? `${r.last_time_ms}ms` : '-';
      const baseline = r.baseline_ms !== null ? `${r.baseline_ms}ms` : '-';
      const errNote = r.error_text ? ` (${r.error_text})` : '';
      lines.push(`| ${r.path} | ${icon} ${r.status}${errNote} | ${time} | ${baseline} |`);
    }
    lines.push('');
  }

  if (apiRoutes.length > 0) {
    lines.push(`### API Routes (${apiRoutes.length})\n`);
    lines.push('| Route | Status | Response Time | Baseline |');
    lines.push('|-------|--------|--------------|----------|');
    for (const r of apiRoutes) {
      const icon = statusIcon[r.status] || '❓';
      const time = r.last_time_ms !== null ? `${r.last_time_ms}ms` : '-';
      const baseline = r.baseline_ms !== null ? `${r.baseline_ms}ms` : '-';
      const errNote = r.error_text ? ` (${r.error_text})` : '';
      lines.push(`| ${r.path} | ${icon} ${r.status}${errNote} | ${time} | ${baseline} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function getSlowRoutes(port: number): Promise<string> {
  const data = await fetchDevApi(port, '/api/slow-routes') as {
    slow_routes: Array<{
      path: string;
      current_ms: number;
      baseline_ms: number;
      ratio: number;
      bottleneck: { name: string; duration_ms: number } | null;
    }>;
  };

  if (data.slow_routes.length === 0) {
    return 'No slow routes detected. All routes are within their baseline performance.';
  }

  const lines: string[] = [];
  lines.push(`## Slow Routes (${data.slow_routes.length})\n`);

  for (const r of data.slow_routes) {
    lines.push(`### ⚠️ ${r.path}`);
    lines.push(`- **Current:** ${r.current_ms}ms`);
    lines.push(`- **Baseline:** ${r.baseline_ms}ms`);
    lines.push(`- **Slowdown:** ${r.ratio}x slower`);
    if (r.bottleneck) {
      lines.push(`- **Bottleneck:** \`${r.bottleneck.name}\` (${r.bottleneck.duration_ms}ms)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function getRouteTraces(port: number, routePath: string, limit: number): Promise<string> {
  const params = new URLSearchParams({ path: routePath, limit: String(limit) });
  const data = await fetchDevApi(port, `/api/route-traces?${params}`) as {
    path: string;
    traces: Array<{
      trace_id: string;
      method: string;
      route: string;
      status_code: number | null;
      duration_ms: number;
      timestamp: number;
      spans: Array<{
        span_id: string;
        parent_span_id: string | null;
        operation: string;
        kind: string;
        duration_ms: number;
        status: string;
        service: string;
        attributes: Record<string, unknown>;
      }>;
    }>;
  };

  if (data.traces.length === 0) {
    return `No traces found for route \`${routePath}\`. The route may not have been hit yet.`;
  }

  const lines: string[] = [];
  lines.push(`## Traces for \`${routePath}\` (${data.traces.length} most recent)\n`);

  for (const trace of data.traces) {
    const time = new Date(trace.timestamp).toLocaleTimeString();
    const statusIcon = (trace.status_code && trace.status_code < 400) ? '✅' : '❌';
    lines.push(`### ${statusIcon} ${trace.method} ${trace.route} — ${trace.duration_ms}ms (${time})`);
    lines.push(`Trace ID: \`${trace.trace_id}\`\n`);

    // Build waterfall
    lines.push('```');
    renderWaterfall(trace.spans, null, 0, lines, trace.spans[0]?.attributes?.['start_time'] as number || 0);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

function renderWaterfall(
  spans: Array<{
    span_id: string;
    parent_span_id: string | null;
    operation: string;
    kind: string;
    duration_ms: number;
    status: string;
    service: string;
    attributes: Record<string, unknown>;
  }>,
  parentId: string | null,
  depth: number,
  lines: string[],
  _baseTime: number,
) {
  const children = spans.filter((s) => s.parent_span_id === parentId);
  for (const span of children) {
    const indent = '  '.repeat(depth);
    const statusMark = span.status === 'ERROR' ? '✗' : '·';
    const kindLabel = span.kind !== 'INTERNAL' ? ` [${span.kind}]` : '';
    const dbStmt = span.attributes['db.statement'];
    const detail = typeof dbStmt === 'string' ? ` — ${dbStmt.substring(0, 80)}` : '';
    lines.push(`${indent}${statusMark} ${span.operation}${kindLabel}  ${span.duration_ms}ms  (${span.service})${detail}`);
    renderWaterfall(spans, span.span_id, depth + 1, lines, _baseTime);
  }
}

// ─── MCP Server setup ───

export async function startDevMcpServer(port: number) {
  // Verify connection to dev instance
  try {
    await fetchDevApi(port, '/health');
  } catch {
    console.error(`Error: Cannot connect to ScanWarp dev server on port ${port}`);
    console.error(`Make sure 'scanwarp dev' is running first.`);
    process.exit(1);
  }

  const server = new Server(
    {
      name: 'scanwarp-dev',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'get_dev_status',
          description:
            'Get the current status of the ScanWarp dev mode monitoring — health, route count, issue count, uptime. Call this first to get an overview.',
          inputSchema: {
            type: 'object' as const,
            properties: {},
          },
        },
        {
          name: 'get_dev_issues',
          description:
            'Get all active issues detected by the real-time analyzers — N+1 queries, unhandled errors, slow queries, missing error handling, slow external calls. Each issue includes severity, message, and a suggested fix.',
          inputSchema: {
            type: 'object' as const,
            properties: {},
          },
        },
        {
          name: 'get_dev_routes',
          description:
            'Get all discovered routes with their current status (healthy/error/slow), last response time, and baseline comparison.',
          inputSchema: {
            type: 'object' as const,
            properties: {},
          },
        },
        {
          name: 'get_slow_routes',
          description:
            'Get routes that are currently slower than their baseline, with bottleneck span info from traces. Useful for finding performance regressions.',
          inputSchema: {
            type: 'object' as const,
            properties: {},
          },
        },
        {
          name: 'get_route_traces',
          description:
            'Get recent traces for a specific route with the full span waterfall. Shows exactly what happens when a request hits a route — database queries, external API calls, processing time, errors.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              path: {
                type: 'string',
                description: 'The route path to get traces for (e.g., "/api/products", "/")',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of recent traces to return (default: 5)',
              },
            },
            required: ['path'],
          },
        },
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'get_dev_status': {
          const result = await getDevStatus(port);
          return { content: [{ type: 'text' as const, text: result }] };
        }

        case 'get_dev_issues': {
          const result = await getDevIssues(port);
          return { content: [{ type: 'text' as const, text: result }] };
        }

        case 'get_dev_routes': {
          const result = await getDevRoutes(port);
          return { content: [{ type: 'text' as const, text: result }] };
        }

        case 'get_slow_routes': {
          const result = await getSlowRoutes(port);
          return { content: [{ type: 'text' as const, text: result }] };
        }

        case 'get_route_traces': {
          const { path: routePath, limit } = args as { path: string; limit?: number };
          const result = await getRouteTraces(port, routePath, limit ?? 5);
          return { content: [{ type: 'text' as const, text: result }] };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ScanWarp dev MCP server running on stdio');
}
