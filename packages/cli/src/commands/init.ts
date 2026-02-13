import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { detectProject, generateDefaultUrl } from '../detector.js';
import { ScanWarpAPI } from '../api.js';
import { setupVercel } from '../integrations/vercel.js';
import { setupStripe } from '../integrations/stripe.js';
import { setupSupabase } from '../integrations/supabase.js';
import { setupMCP } from '../integrations/mcp.js';
import { setupNotifications } from '../integrations/notifications.js';
import { setupInstrumentation } from '../integrations/instrument.js';
import { config } from '../config.js';

interface InitOptions {
  server?: string;
  url?: string;
  skipVercel?: boolean;
  skipMcp?: boolean;
}

export async function initCommand(options: InitOptions = {}) {
  console.log(chalk.bold.cyan('\n🚀 ScanWarp Setup\n'));
  console.log(chalk.gray('Your AI writes your code. ScanWarp keeps it running.\n'));

  // Step 1: Auto-detect project
  const spinner = ora('Detecting project...').start();
  const detected = detectProject();
  spinner.succeed('Project detected');

  // Print what was found
  console.log(chalk.bold('\n✓ Project Details:'));
  if (detected.framework) {
    console.log(chalk.green(`  ✓ Framework: ${detected.framework}`));
  }
  if (detected.hosting) {
    console.log(chalk.green(`  ✓ Hosting: ${detected.hosting}`));
  }
  if (detected.services.length > 0) {
    console.log(chalk.green(`  ✓ Services: ${detected.services.join(', ')}`));
  }
  if (detected.projectName) {
    console.log(chalk.green(`  ✓ Project: ${detected.projectName}`));
  }

  if (!detected.hasPackageJson) {
    console.log(chalk.yellow('\n⚠ No package.json found. Are you in a Node.js project?'));
  }

  // Step 2: Get production URL
  const defaultUrl = options.url || generateDefaultUrl(detected);

  const { productionUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'productionUrl',
      message: 'What is your production URL?',
      default: defaultUrl,
      validate: (input: string) => {
        try {
          new URL(input);
          return true;
        } catch {
          return 'Please enter a valid URL (e.g., https://example.com)';
        }
      },
    },
  ]);

  // Validate URL is reachable
  const urlSpinner = ora('Checking if URL is reachable...').start();
  try {
    const response = await fetch(productionUrl, { method: 'HEAD' });
    if (response.ok) {
      urlSpinner.succeed(`URL is reachable (${response.status})`);
    } else {
      urlSpinner.warn(`URL returned ${response.status} (continuing anyway)`);
    }
  } catch (error) {
    urlSpinner.warn('Could not reach URL (continuing anyway)');
  }

  // Step 3: Connect to ScanWarp server
  const serverUrl = options.server || 'http://localhost:3000';
  const api = new ScanWarpAPI(serverUrl);

  const serverSpinner = ora('Connecting to ScanWarp server...').start();
  const isConnected = await api.testConnection();

  if (!isConnected) {
    serverSpinner.fail(`Could not connect to ${serverUrl}`);
    console.log(chalk.yellow('\n⚠ Make sure the ScanWarp server is running.'));
    console.log(chalk.gray('  Run: cd apps/server && pnpm dev\n'));
    process.exit(1);
  }
  serverSpinner.succeed(`Connected to ${serverUrl}`);

  // Save server URL to config
  config.setServerUrl(serverUrl);

  // Step 4: Create project and monitor
  const setupSpinner = ora('Setting up monitoring...').start();
  let projectId: string;

  try {
    const project = await api.createProject(detected.projectName || 'my-app');
    const monitor = await api.createMonitor(project.id, productionUrl);

    projectId = project.id;

    // Save project ID to config
    config.setProjectId(project.id);

    setupSpinner.succeed('Monitoring configured');

    console.log(chalk.green(`\n  ✓ Project ID: ${project.id}`));
    console.log(chalk.green(`  ✓ Monitor ID: ${monitor.id}`));
    console.log(chalk.green(`  ✓ Checking ${productionUrl} every 60 seconds\n`));
  } catch (error) {
    setupSpinner.fail('Failed to set up monitoring');
    console.error(chalk.red('\nError:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }

  // Step 5: Provider integrations
  console.log(chalk.bold('\n📦 Provider Integrations\n'));

  // Vercel
  if (detected.hosting === 'Vercel' && !options.skipVercel) {
    await setupVercel(api, detected);
  }

  // Stripe
  if (detected.services.includes('Stripe')) {
    await setupStripe(api);
  }

  // Supabase
  if (detected.services.includes('Supabase')) {
    await setupSupabase(api);
  }

  // Step 6: Request Tracing
  console.log(chalk.bold('\n📡 Request Tracing\n'));
  await setupInstrumentation(detected, serverUrl, projectId);

  // Step 7: MCP Configuration
  if (!options.skipMcp) {
    console.log(chalk.bold('\n🤖 MCP Configuration\n'));
    await setupMCP(serverUrl);
  }

  // Step 8: Notifications
  console.log(chalk.bold('\n🔔 Notifications\n'));
  await setupNotifications();

  // Step 9: Summary
  printSummary(api, productionUrl, detected);
}

function printSummary(api: ScanWarpAPI, url: string, _detected: unknown) {
  console.log(chalk.bold.green('\n✨ Setup Complete!\n'));

  console.log(chalk.bold('Your monitoring is now active:'));
  console.log(chalk.gray(`  • Monitoring: ${url}`));
  console.log(chalk.gray(`  • Check interval: Every 60 seconds`));
  console.log(chalk.gray(`  • Dashboard: ${api.serverUrl}\n`));

  console.log(chalk.bold('Next steps:'));
  console.log(chalk.gray('  1. Deploy your app to trigger monitoring'));
  console.log(chalk.gray('  2. Visit the dashboard to see events and incidents'));
  console.log(chalk.gray('  3. Check your notifications for any alerts\n'));

  console.log(chalk.bold('Useful commands:'));
  console.log(chalk.gray('  • scanwarp status    - Check monitoring status'));
  console.log(chalk.gray('  • scanwarp events    - View recent events'));
  console.log(chalk.gray('  • scanwarp incidents - View open incidents\n'));

  console.log(chalk.cyan('Happy shipping! 🚀\n'));
}
