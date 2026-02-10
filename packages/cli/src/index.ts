#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { logsCommand } from './commands/logs.js';
import { config } from './config.js';

const program = new Command();

program
  .name('scanwarp')
  .description('Your AI writes your code. ScanWarp keeps it running.')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize ScanWarp monitoring for your project')
  .option('-s, --server <url>', 'ScanWarp server URL')
  .option('-u, --url <url>', 'Production URL to monitor')
  .option('--skip-vercel', 'Skip Vercel integration setup')
  .option('--skip-mcp', 'Skip MCP configuration')
  .action(async (options) => {
    try {
      // Use config as fallback for server URL
      options.server = options.server || config.getServerUrl();
      await initCommand(options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check monitoring status')
  .option('-s, --server <url>', 'ScanWarp server URL')
  .action(async (options) => {
    try {
      options.server = options.server || config.getServerUrl();
      await statusCommand(options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('logs')
  .alias('events')
  .description('View recent events')
  .option('-s, --server <url>', 'ScanWarp server URL')
  .option('-f, --follow', 'Follow log output (live streaming)')
  .option('-t, --type <type>', 'Filter by event type (error/slow/down/up)')
  .option('--source <source>', 'Filter by source (monitor/vercel/stripe/supabase/github)')
  .option('-l, --limit <number>', 'Number of events to show', '50')
  .action(async (options) => {
    try {
      options.server = options.server || config.getServerUrl();
      options.limit = parseInt(options.limit);
      await logsCommand(options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('incidents')
  .description('View open incidents')
  .option('-s, --server <url>', 'ScanWarp server URL', 'http://localhost:3000')
  .action(() => {
    console.log('Incidents command coming soon...');
  });

program.parse();
