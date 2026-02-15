import chalk from 'chalk';
import path from 'path';
import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import { checkRoutes, printRouteResults, type RouteCheckResult } from './route-checker.js';
import type { DiscoveredRoutes, RouteFileMap } from './route-discovery.js';
import type { SchemaTracker } from './analyzers/schema-drift.js';

export function startFileWatcher(
  cwd: string,
  routes: DiscoveredRoutes,
  routeFileMap: RouteFileMap,
  previousResults: Map<string, RouteCheckResult>,
  baselines: Map<string, number>,
  schemaTracker: SchemaTracker,
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

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const changedFiles = new Set(pendingFiles);
      pendingFiles = new Set();

      const affectedRoutes = resolveAffectedRoutes(changedFiles, routes, routeFileMap);
      if (affectedRoutes.length === 0) return;

      schemaTracker.resetForRoutes(affectedRoutes);

      const fileNames = [...changedFiles].map((f) => path.relative(cwd, f)).join(', ');
      console.log('');
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.bold.cyan(`\n  File changed: ${chalk.white(fileNames)}\n`));
      console.log(chalk.bold(`  Re-checking ${affectedRoutes.length} route${affectedRoutes.length > 1 ? 's' : ''}...\n`));

      const newResults = await checkRoutes(affectedRoutes, devServerPort);
      printRouteResults(newResults, { previousResults, baselines, quiet: true, schemaTracker });

      for (const r of newResults) {
        previousResults.set(r.route, r);
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
      affected.add(route);
    } else {
      hasNonRouteFile = true;
    }
  }

  if (hasNonRouteFile) {
    const staticApiRoutes = routes.apiRoutes.filter((r) => !r.includes('['));
    for (const route of staticApiRoutes) {
      affected.add(route);
    }
  }

  return [...affected];
}
