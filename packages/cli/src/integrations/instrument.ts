import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { DetectedProject } from '../detector.js';

const NEXTJS_INSTRUMENTATION = `export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@scanwarp/instrument");
  }
}
`;

type PackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun';

export async function setupInstrumentation(
  detected: DetectedProject,
  serverUrl: string,
  projectId: string,
  shouldPrompt: boolean = true,
) {
  let enableTracing = true;

  if (shouldPrompt) {
    const response = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enableTracing',
        message: 'Enable request tracing? (recommended)',
        default: true,
      },
    ]);
    enableTracing = response.enableTracing;
  }

  if (!enableTracing) {
    console.log(chalk.gray('  Skipped\n'));
    return;
  }

  console.log(chalk.gray('  Setting up production instrumentation for monitoring...\n'));

  const cwd = process.cwd();
  const isNextJs = detected.framework === 'Next.js';
  const packageManager = detectPackageManager(cwd);
  const serviceName = detected.projectName || 'my-app';

  // Step 1: Install @scanwarp/instrument
  const installSpinner = ora('Installing @scanwarp/instrument...').start();

  try {
    const installCmd = getInstallCommand(packageManager);
    execSync(installCmd, { cwd, stdio: 'pipe' });
    installSpinner.succeed('Installed @scanwarp/instrument');
  } catch {
    installSpinner.fail('Failed to install @scanwarp/instrument');
    console.log(chalk.yellow('  Run manually:'));
    console.log(chalk.cyan(`  ${getInstallCommand(packageManager)}\n`));
  }

  // Step 2: Framework-specific setup
  if (isNextJs) {
    await setupNextJs(cwd);
  } else {
    setupGenericNode();
  }

  // Step 3: Add env vars to .env.local or .env
  const envPath = path.join(cwd, '.env');
  const envLocalPath = path.join(cwd, '.env.local');
  const targetEnv = fs.existsSync(envLocalPath) ? envLocalPath : envPath;
  const envVars: Record<string, string> = {
    SCANWARP_PROJECT_ID: projectId,
    SCANWARP_SERVER: serverUrl,
    SCANWARP_SERVICE_NAME: serviceName,
  };

  console.log(chalk.bold('\n  Environment variables:\n'));
  for (const [key, val] of Object.entries(envVars)) {
    console.log(chalk.cyan(`  ${key}=${val}`));
  }

  if (fs.existsSync(targetEnv)) {
    const { writeEnv } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'writeEnv',
        message: `Append to ${path.basename(targetEnv)}?`,
        default: true,
      },
    ]);

    if (writeEnv) {
      appendEnvVars(targetEnv, envVars);
    }
  } else {
    // No .env file exists — create .env.local for Next.js, .env otherwise
    const newEnvPath = isNextJs ? envLocalPath : envPath;

    const { createEnv } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'createEnv',
        message: `Create ${path.basename(newEnvPath)}?`,
        default: true,
      },
    ]);

    if (createEnv) {
      const lines = Object.entries(envVars)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
      fs.writeFileSync(newEnvPath, `# ScanWarp tracing\n${lines}\n`);
      console.log(chalk.green(`  ✓ Created ${path.basename(newEnvPath)}`));
    }
  }

  // Step 4: Success message
  console.log(chalk.bold.green('\n  ✓ Request tracing configured!\n'));

  if (isNextJs) {
    console.log(chalk.gray('  Traces will be sent automatically when your Next.js app starts.'));
  } else {
    console.log(chalk.gray('  Add NODE_OPTIONS to your start command to enable tracing:'));
    console.log(chalk.cyan(`\n  NODE_OPTIONS="--require @scanwarp/instrument" node ./dist/server.js\n`));
    console.log(chalk.gray('  Or set it in your environment / package.json scripts:'));
    console.log(chalk.cyan(`  "start": "NODE_OPTIONS='--require @scanwarp/instrument' node ./dist/server.js"`));
  }

  console.log('');
}

async function setupNextJs(cwd: string) {
  // Step 2a: Create instrumentation.ts
  const tsPath = path.join(cwd, 'instrumentation.ts');
  const srcTsPath = path.join(cwd, 'src', 'instrumentation.ts');
  const hasSrcDir = fs.existsSync(path.join(cwd, 'src'));
  const targetPath = hasSrcDir ? srcTsPath : tsPath;

  if (fs.existsSync(tsPath) || fs.existsSync(srcTsPath)) {
    console.log(chalk.yellow('\n  ⚠ instrumentation.ts already exists'));
    console.log(chalk.gray('  Add this to your register() function:\n'));
    console.log(chalk.cyan('    await import("@scanwarp/instrument");'));
  } else {
    const spinner = ora('Creating instrumentation.ts...').start();
    fs.writeFileSync(targetPath, NEXTJS_INSTRUMENTATION);
    const relPath = path.relative(cwd, targetPath);
    spinner.succeed(`Created ${relPath}`);
  }

  // Step 2b: Patch next.config to enable instrumentationHook
  await patchNextConfig(cwd);
}

async function patchNextConfig(cwd: string) {
  // Find the next.config file
  const candidates = [
    'next.config.ts',
    'next.config.mjs',
    'next.config.js',
  ];

  let configPath: string | null = null;
  for (const name of candidates) {
    const fullPath = path.join(cwd, name);
    if (fs.existsSync(fullPath)) {
      configPath = fullPath;
      break;
    }
  }

  if (!configPath) {
    console.log(chalk.yellow('  ⚠ No next.config file found'));
    console.log(chalk.gray('  Add this to your next.config.js:\n'));
    console.log(chalk.cyan('    experimental: { instrumentationHook: true }'));
    return;
  }

  const content = fs.readFileSync(configPath, 'utf-8');
  const configName = path.basename(configPath);

  // Check if instrumentationHook is already set
  if (content.includes('instrumentationHook')) {
    console.log(chalk.green(`  ✓ ${configName} already has instrumentationHook`));
    return;
  }

  // Try to patch the config automatically
  // Look for an existing `experimental` block
  if (content.includes('experimental')) {
    // There's an existing experimental block — try to add instrumentationHook to it
    const patched = content.replace(
      /experimental\s*:\s*\{/,
      'experimental: {\n    instrumentationHook: true,',
    );

    if (patched !== content) {
      fs.writeFileSync(configPath, patched);
      console.log(chalk.green(`  ✓ Added instrumentationHook to ${configName}`));
      return;
    }
  }

  // Look for the config object to inject experimental block
  // Match patterns like: `const nextConfig = {` or `module.exports = {` or `export default {`
  const configObjectPattern =
    /((?:const\s+\w+\s*=|module\.exports\s*=|export\s+default)\s*\{)/;
  const match = content.match(configObjectPattern);

  if (match) {
    const patched = content.replace(
      match[1],
      `${match[1]}\n  experimental: { instrumentationHook: true },`,
    );
    fs.writeFileSync(configPath, patched);
    console.log(chalk.green(`  ✓ Added experimental.instrumentationHook to ${configName}`));
    return;
  }

  // Could not auto-patch — instruct user
  console.log(chalk.yellow(`  ⚠ Could not auto-patch ${configName}`));
  console.log(chalk.gray('  Add this to your Next.js config:\n'));
  console.log(chalk.cyan('    experimental: { instrumentationHook: true }\n'));
}

function setupGenericNode() {
  console.log(chalk.bold('\n  Add tracing to your start command:\n'));
  console.log(chalk.cyan(`  NODE_OPTIONS="--require @scanwarp/instrument" node ./dist/server.js`));
  console.log('');
  console.log(chalk.gray('  Or add as the first import in your entrypoint:'));
  console.log(chalk.cyan('  import "@scanwarp/instrument";'));
}

function appendEnvVars(filePath: string, vars: Record<string, string>) {
  const existing = fs.readFileSync(filePath, 'utf-8');
  const additions: string[] = [];

  for (const [key, val] of Object.entries(vars)) {
    if (!existing.includes(key)) {
      additions.push(`${key}=${val}`);
    }
  }

  if (additions.length > 0) {
    const separator = existing.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(filePath, `${separator}\n# ScanWarp tracing\n${additions.join('\n')}\n`);
    console.log(chalk.green(`  ✓ Updated ${path.basename(filePath)}`));
  } else {
    console.log(chalk.gray(`  ✓ Variables already present in ${path.basename(filePath)}`));
  }
}

function detectPackageManager(cwd: string): PackageManager {
  if (fs.existsSync(path.join(cwd, 'bun.lockb')) || fs.existsSync(path.join(cwd, 'bun.lock'))) return 'bun';
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function getInstallCommand(pm: PackageManager): string {
  switch (pm) {
    case 'bun':
      return 'bun add @scanwarp/instrument';
    case 'pnpm':
      return 'pnpm add @scanwarp/instrument';
    case 'yarn':
      return 'yarn add @scanwarp/instrument';
    case 'npm':
      return 'npm install @scanwarp/instrument';
  }
}
