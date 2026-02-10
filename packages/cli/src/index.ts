#!/usr/bin/env node

import { Command } from 'commander';

const program = new Command();

program
  .name('scanwarp')
  .description('Your AI writes your code. ScanWarp keeps it running.')
  .version('0.1.0');

program
  .command('monitor')
  .description('Start monitoring a service')
  .argument('<service>', 'Service name to monitor')
  .action((service: string) => {
    console.log(`Monitoring service: ${service}`);
  });

program
  .command('status')
  .description('Check monitoring status')
  .action(() => {
    console.log('Checking status...');
  });

program.parse();
