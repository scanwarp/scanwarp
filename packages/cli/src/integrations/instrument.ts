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

const NODE_REQUIRE_EXAMPLE = `node --require @scanwarp/instrument ./dist/server.js`;

export async function setupInstrumentation(
  detected: DetectedProject,
  serverUrl: string,
  projectId: string,
) {
  const { enableTracing } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableTracing',
      message: 'Enable request tracing? (recommended)',
      default: true,
    },
  ]);

  if (!enableTracing) {
    console.log(chalk.gray('  Skipped\n'));
    return;
  }

  const cwd = process.cwd();
  const isNextJs = detected.framework === 'Next.js';
  const packageManager = detectPackageManager(cwd);

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
    setupGenericNode(detected);
  }

  // Step 3: Print env vars to add
  console.log(chalk.bold('\n  Add these to your .env file:\n'));
  console.log(chalk.cyan(`  SCANWARP_PROJECT_ID=${projectId}`));
  console.log(chalk.cyan(`  SCANWARP_SERVER=${serverUrl}`));

  // Write to .env if it exists
  const envPath = path.join(cwd, '.env');
  const envLocalPath = path.join(cwd, '.env.local');
  const targetEnv = fs.existsSync(envLocalPath) ? envLocalPath : envPath;

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
      const existing = fs.readFileSync(targetEnv, 'utf-8');
      const additions: string[] = [];

      if (!existing.includes('SCANWARP_PROJECT_ID')) {
        additions.push(`SCANWARP_PROJECT_ID=${projectId}`);
      }
      if (!existing.includes('SCANWARP_SERVER')) {
        additions.push(`SCANWARP_SERVER=${serverUrl}`);
      }

      if (additions.length > 0) {
        const separator = existing.endsWith('\n') ? '' : '\n';
        fs.appendFileSync(targetEnv, `${separator}\n# ScanWarp tracing\n${additions.join('\n')}\n`);
        console.log(chalk.green(`\n  ✓ Updated ${path.basename(targetEnv)}`));
      } else {
        console.log(chalk.gray(`\n  ✓ Variables already present in ${path.basename(targetEnv)}`));
      }
    }
  }

  console.log('');
}

async function setupNextJs(cwd: string) {
  // Check for existing instrumentation.ts
  const tsPath = path.join(cwd, 'instrumentation.ts');
  const srcTsPath = path.join(cwd, 'src', 'instrumentation.ts');
  const hasSrcDir = fs.existsSync(path.join(cwd, 'src'));
  const targetPath = hasSrcDir ? srcTsPath : tsPath;

  if (fs.existsSync(tsPath) || fs.existsSync(srcTsPath)) {
    console.log(chalk.yellow('\n  ⚠ instrumentation.ts already exists'));
    console.log(chalk.gray('  Add this to your register() function:\n'));
    console.log(chalk.cyan('    await import("@scanwarp/instrument");'));
    console.log('');
    return;
  }

  const spinner = ora('Creating instrumentation.ts...').start();
  fs.writeFileSync(targetPath, NEXTJS_INSTRUMENTATION);
  const relPath = path.relative(cwd, targetPath);
  spinner.succeed(`Created ${relPath}`);
}

function setupGenericNode(detected: DetectedProject) {
  console.log(chalk.bold('\n  Add tracing to your start command:\n'));

  if (detected.framework === 'Express' || detected.framework === 'Fastify' || !detected.framework) {
    console.log(chalk.cyan(`  ${NODE_REQUIRE_EXAMPLE}`));
    console.log('');
    console.log(chalk.gray('  Or add as the first import in your entrypoint:'));
    console.log(chalk.cyan('  import "@scanwarp/instrument";'));
  } else {
    console.log(chalk.gray('  Option 1: --require flag'));
    console.log(chalk.cyan(`  ${NODE_REQUIRE_EXAMPLE}`));
    console.log('');
    console.log(chalk.gray('  Option 2: First import in your entrypoint'));
    console.log(chalk.cyan('  import "@scanwarp/instrument";'));
  }
}

function detectPackageManager(cwd: string): 'pnpm' | 'yarn' | 'npm' {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function getInstallCommand(pm: 'pnpm' | 'yarn' | 'npm'): string {
  switch (pm) {
    case 'pnpm':
      return 'pnpm add @scanwarp/instrument';
    case 'yarn':
      return 'yarn add @scanwarp/instrument';
    case 'npm':
      return 'npm install @scanwarp/instrument';
  }
}
