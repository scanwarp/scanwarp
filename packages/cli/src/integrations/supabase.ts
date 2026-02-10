import inquirer from 'inquirer';
import chalk from 'chalk';
import type { ScanWarpAPI } from '../api.js';

export async function setupSupabase(_api: ScanWarpAPI) {
  console.log(chalk.bold('Supabase Monitoring'));

  const { setupSupabase } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'setupSupabase',
      message: 'Monitor Supabase database health and connection pool?',
      default: true,
    },
  ]);

  if (!setupSupabase) {
    console.log(chalk.gray('  Skipped\n'));
    return;
  }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectRef',
      message: 'Supabase project ref (e.g., abcdefghijklmnop):',
      validate: (input: string) => (input.length > 0 ? true : 'Project ref is required'),
    },
    {
      type: 'password',
      name: 'serviceKey',
      message: 'Supabase service role key:',
      validate: (input: string) => (input.length > 0 ? true : 'Service key is required'),
    },
  ]);

  console.log(chalk.green('\n  ✓ Configuration saved\n'));
  console.log(chalk.yellow('  Add these to your server .env file:\n'));
  console.log(chalk.cyan(`  SUPABASE_PROJECT_REF=${answers.projectRef}`));
  console.log(chalk.cyan(`  SUPABASE_SERVICE_KEY=${answers.serviceKey}`));
  console.log(chalk.cyan(`  SUPABASE_MAX_CONNECTIONS=100\n`));

  console.log(chalk.gray('  Press Enter to continue...'));
  await new Promise((resolve) => process.stdin.once('data', resolve));
}
