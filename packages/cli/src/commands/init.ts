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
import { setupBrowserMonitoring } from '../integrations/browser.js';
import { config } from '../config.js';

interface InitOptions {
  server?: string;
  url?: string;
  skipVercel?: boolean;
  skipMcp?: boolean;
  skipInstrumentation?: boolean;
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

    if (options.server) {
      // User explicitly provided a server URL — just report the error
      console.log(chalk.yellow('\n⚠ Make sure the ScanWarp server is running at that URL.\n'));
    } else {
      // No server specified, localhost failed — suggest deployment options
      console.log(chalk.yellow('\n⚠ No local ScanWarp server found.\n'));
      console.log(chalk.bold('  Option 1: Deploy a hosted server (60 seconds)\n'));
      console.log(chalk.gray('    Railway: https://railway.com/template/scanwarp'));
      console.log(chalk.gray('    Render:  https://render.com/deploy?repo=https://github.com/scanwarp/scanwarp\n'));
      console.log(chalk.gray('    Then run:'));
      console.log(chalk.white('    npx scanwarp init --server https://your-server-url.up.railway.app\n'));
      console.log(chalk.bold('  Option 2: Run locally\n'));
      console.log(chalk.gray('    docker compose up -d'));
      console.log(chalk.gray('    npx scanwarp init --server http://localhost:3000\n'));
    }
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
  if (!options.skipInstrumentation) {
    console.log(chalk.bold('\n📡 Request Tracing\n'));
    await setupInstrumentation(detected, serverUrl, projectId, false); // false = don't prompt, install by default
  }

  // Step 7: Browser Error Monitoring
  console.log(chalk.bold('\n🌐 Browser Error Monitoring\n'));
  await setupBrowserMonitoring(detected, serverUrl, projectId);

  // Step 8: MCP Configuration
  if (!options.skipMcp) {
    console.log(chalk.bold('\n🤖 MCP Configuration\n'));
    await setupMCP(serverUrl);
  }

  // Step 9: Notifications
  console.log(chalk.bold('\n🔔 Notifications\n'));
  await setupNotifications();

  // Step 10: Summary
  printSummary(api, productionUrl, detected);
}

function printSummary(api: ScanWarpAPI, url: string, _detected: unknown) {
  console.log(chalk.bold.green('\n✨ Setup Complete!\n'));

  console.log(chalk.bold('Your monitoring is now active:'));
  console.log(chalk.gray(`  • Monitoring: ${url}`));
  console.log(chalk.gray(`  • Check interval: Every 60 seconds\n`));

  // Dashboard - make it prominent
  console.log(chalk.bold.cyan('📊 Dashboard:'));
  console.log(chalk.white.bold(`  → ${api.serverUrl}\n`));
  console.log(chalk.gray('  What you\'ll find:'));
  console.log(chalk.gray('    • Overview - System health at a glance'));
  console.log(chalk.gray('    • Monitors - Uptime and response times'));
  console.log(chalk.gray('    • Events - Real-time feed from your app'));
  console.log(chalk.gray('    • Incidents - Auto-detected issues with AI diagnosis'));
  console.log(chalk.gray('    • Traces - Request waterfalls with bottleneck highlighting\n'));

  // MCP Integration
  console.log(chalk.bold.cyan('🤖 Connect Your AI Tool:'));
  console.log(chalk.gray('  Your AI can now see what\'s broken via MCP:'));
  console.log(chalk.gray('    • Ask: "What\'s broken in production?"'));
  console.log(chalk.gray('    • Ask: "Show me the slowest requests"'));
  console.log(chalk.gray('    • Ask: "Get the fix prompt for the latest incident"\n'));

  console.log(chalk.bold('Next steps:'));
  console.log(chalk.gray('  1. Deploy your app to start monitoring'));
  console.log(chalk.gray(`  2. Visit ${api.serverUrl} to see your dashboard`));
  console.log(chalk.gray('  3. Check your notifications for alerts\n'));

  console.log(chalk.bold('Useful commands:'));
  console.log(chalk.gray('  • scanwarp status  - Check monitoring status'));
  console.log(chalk.gray('  • scanwarp events  - View recent events'));
  console.log(chalk.gray('  • scanwarp dev     - Run full monitoring locally\n'));

  console.log(chalk.cyan('Happy shipping! 🚀\n'));
  console.log(chalk.gray(`Learn more: ${chalk.white('https://github.com/scanwarp/scanwarp')}`));
  console.log(chalk.gray(`Join Discord: ${chalk.white('https://discord.gg/K79UAMudM')}\n`));
}
