import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, type ChildProcess } from 'child_process';

interface ServerOptions {
  port?: number;
  dbPath?: string;
}

export async function serverCommand(options: ServerOptions) {
  const port = options.port || 3000;

  // Determine SQLite database path
  const scanwarpDir = path.join(os.homedir(), '.scanwarp');
  if (!fs.existsSync(scanwarpDir)) {
    fs.mkdirSync(scanwarpDir, { recursive: true });
  }
  const dbPath = options.dbPath || path.join(scanwarpDir, 'scanwarp.db');

  // Find the server entry point
  const serverEntry = findServerEntry();
  if (!serverEntry) {
    console.error(
      chalk.red('Could not find @scanwarp/server. Make sure you are running from the ScanWarp repo or have @scanwarp/server installed.')
    );
    process.exit(1);
  }

  console.log('');
  console.log(chalk.bold('ScanWarp Server'));
  console.log('');
  console.log(`  ${chalk.dim('Port:')}     ${port}`);
  console.log(`  ${chalk.dim('Database:')} SQLite → ${dbPath}`);
  console.log(`  ${chalk.dim('Entry:')}    ${serverEntry}`);
  console.log('');

  // Spawn the server process with SQLite config
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    DATABASE_TYPE: 'sqlite',
    SQLITE_PATH: dbPath,
    PORT: String(port),
  };

  const child: ChildProcess = spawn(
    process.execPath,
    [serverEntry],
    {
      env,
      stdio: 'inherit',
      cwd: path.dirname(serverEntry),
    }
  );

  child.on('error', (err) => {
    console.error(chalk.red(`Failed to start server: ${err.message}`));
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(chalk.red(`Server exited with code ${code}`));
    }
    process.exit(code ?? 0);
  });

  // Forward signals for graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const sig of signals) {
    process.on(sig, () => {
      child.kill(sig);
    });
  }
}

function findServerEntry(): string | null {
  // Strategy 1: Monorepo sibling (packages/cli → apps/server)
  const cliDir = path.resolve(__dirname, '..', '..');
  const monorepoServer = path.resolve(cliDir, '..', '..', 'apps', 'server', 'dist', 'index.js');
  if (fs.existsSync(monorepoServer)) {
    return monorepoServer;
  }

  // Strategy 2: Check for tsx + source (dev mode)
  const monorepoServerSrc = path.resolve(cliDir, '..', '..', 'apps', 'server', 'src', 'index.ts');
  if (fs.existsSync(monorepoServerSrc)) {
    // Check if tsx is available
    const tsxPath = path.resolve(cliDir, '..', '..', 'node_modules', '.bin', 'tsx');
    if (fs.existsSync(tsxPath)) {
      return monorepoServerSrc;
    }
  }

  // Strategy 3: node_modules (installed as dependency)
  try {
    const resolved = require.resolve('@scanwarp/server');
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  } catch {
    // Module not found
  }

  // Strategy 4: Walk up looking for node_modules/@scanwarp/server
  let dir = cliDir;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'node_modules', '@scanwarp', 'server', 'dist', 'index.js');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}
