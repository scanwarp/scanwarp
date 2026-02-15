import fs from 'fs';
import path from 'path';
import type { DetectedProject } from '../detector.js';

export interface DiscoveredRoutes {
  pages: string[];
  apiRoutes: string[];
}

export interface RouteFileMap {
  fileToRoute: Map<string, string>;
  fileToType: Map<string, 'page' | 'api'>;
}

export function discoverRoutes(
  detected: DetectedProject,
  cwd: string,
  routeFileMap?: RouteFileMap
): DiscoveredRoutes {
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
