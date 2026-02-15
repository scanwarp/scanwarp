import chalk from 'chalk';
import type { SchemaTracker } from './analyzers/schema-drift.js';
import type { DiscoveredRoutes } from './route-discovery.js';

export interface RouteCheckResult {
  route: string;
  method: string;
  status: number;
  timeMs: number;
  errorText?: string;
  responseBody?: unknown;
}

export interface PrintRouteOptions {
  previousResults?: Map<string, RouteCheckResult>;
  baselines?: Map<string, number>;
  quiet?: boolean;
  schemaTracker?: SchemaTracker;
}

export async function crawlRoutes(
  routes: DiscoveredRoutes,
  port: number,
  schemaTracker?: SchemaTracker
): Promise<RouteCheckResult[]> {
  const allGetRoutes = [
    ...routes.pages,
    ...routes.apiRoutes.filter((r) => !r.includes('[') || !r.includes(']')),
  ];

  const staticRoutes = allGetRoutes.filter((r) => !r.includes('['));

  if (staticRoutes.length === 0) {
    console.log(chalk.gray('  No static routes to check (all routes are dynamic)\n'));
    return [];
  }

  console.log(chalk.bold('  Initial scan:\n'));

  const checkResults = await checkRoutes(staticRoutes, port);
  printRouteResults(checkResults, { schemaTracker });

  return checkResults;
}

export async function checkRoutes(routes: string[], port: number): Promise<RouteCheckResult[]> {
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

      let errorText: string | undefined;
      let responseBody: unknown | undefined;

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
      } else if (response.status >= 200 && response.status < 300 && route.startsWith('/api/')) {
        try {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            responseBody = await response.json();
          }
        } catch {
          // Not valid JSON — skip
        }
      }

      results.push({ route, method: 'GET', status: response.status, timeMs, errorText, responseBody });
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

export function printRouteResults(results: RouteCheckResult[], opts: PrintRouteOptions = {}) {
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

    let slowIndicator = '';
    if (isOk && baselines) {
      const baseline = baselines.get(r.route);
      if (baseline !== undefined && r.timeMs > 500 && r.timeMs > baseline * 3) {
        slowIndicator = `  ${chalk.yellow(`SLOW (baseline: ${baseline}ms)`)}`;
        hasChange = true;
      }
    }

    if (quiet && isOk && !hasChange) {
      suppressedOkCount++;
      continue;
    }

    const icon = isOk ? chalk.green('✓') : chalk.red('✗');
    console.log(`   ${icon} ${padded} ${timeColor}${statusStr}${errStr}${changeIndicator}${slowIndicator}`);
    printedCount++;
  }

  const okCount = results.filter((r) => r.status > 0 && r.status < 400).length;
  const errCount = results.filter((r) => r.status === 0 || r.status >= 400).length;
  const validResults = results.filter((r) => r.status > 0);
  const avgTime = validResults.length > 0
    ? Math.round(validResults.reduce((sum, r) => sum + r.timeMs, 0) / validResults.length)
    : 0;

  if (quiet && suppressedOkCount > 0 && printedCount > 0) {
    console.log(chalk.gray(`   ... (${suppressedOkCount} more OK)`));
  }

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

  // Schema drift detection for API routes
  if (opts.schemaTracker) {
    for (const r of results) {
      if (r.responseBody !== undefined && r.status >= 200 && r.status < 300) {
        const diffs = opts.schemaTracker.processResponse(r.route, r.method, r.responseBody);
        (opts.schemaTracker.constructor as typeof SchemaTracker).printDrift(r.route, r.method, diffs);
      }
    }
  }
}
