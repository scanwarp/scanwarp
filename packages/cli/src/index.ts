#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { logsCommand } from './commands/logs.js';
import { devCommand } from './commands/dev.js';
import { devMcpCommand } from './commands/dev-mcp.js';
import { serverCommand } from './commands/server.js';
import { mcpCommand } from './commands/mcp.js';
import { config } from './config.js';

const program = new Command();

program
  .name('scanwarp')
  .description('Your AI writes your code. ScanWarp keeps it running.')
  .version('0.3.0');

program
  .command('init')
  .description('Initialize ScanWarp monitoring for your project')
  .option('-s, --server <url>', 'ScanWarp server URL')
  .option('-u, --url <url>', 'Production URL to monitor')
  .option('--skip-vercel', 'Skip Vercel integration setup')
  .option('--skip-mcp', 'Skip MCP configuration')
  .option('--skip-instrumentation', 'Skip production instrumentation setup')
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
  .command('dev')
  .description('Start your dev server with ScanWarp monitoring')
  .option('-c, --command <cmd>', 'Dev server command to run (auto-detected if omitted)')
  .option('-p, --port <number>', 'Port for local ScanWarp server')
  .action(async (options) => {
    try {
      if (options.port) options.port = parseInt(options.port);
      await devCommand(options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('dev-mcp')
  .description('Start MCP server for AI coding tools (connects to running scanwarp dev)')
  .option('-p, --port <number>', 'Port of the running ScanWarp dev server', '3456')
  .action(async (options) => {
    try {
      if (options.port) options.port = parseInt(options.port);
      await devMcpCommand(options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('server')
  .alias('serve')
  .description('Start ScanWarp server locally with SQLite (no Docker required)')
  .option('-p, --port <number>', 'Port to listen on', '3000')
  .option('--db-path <path>', 'SQLite database file path')
  .action(async (options) => {
    try {
      if (options.port) options.port = parseInt(options.port);
      await serverCommand(options);
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

program
  .command('mcp')
  .description('Start MCP server for AI coding tools (production monitoring)')
  .option('-s, --server <url>', 'ScanWarp server URL')
  .option('-t, --token <token>', 'API token for authentication')
  .option('-p, --project <id>', 'Default project ID')
  .action(async (options) => {
    try {
      await mcpCommand(options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();

// Re-export from @scanwarp/core for backward compatibility
export * from '@scanwarp/core';
