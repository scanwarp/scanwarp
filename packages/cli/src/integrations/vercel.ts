import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import type { ScanWarpAPI } from '../api.js';
import type { DetectedProject } from '../detector.js';

export async function setupVercel(api: ScanWarpAPI, _detected: DetectedProject) {
  console.log(chalk.bold('Vercel Log Drain'));

  const { setupVercel } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'setupVercel',
      message: 'Set up Vercel log drain to capture errors?',
      default: true,
    },
  ]);

  if (!setupVercel) {
    console.log(chalk.gray('  Skipped\n'));
    return;
  }

  const { vercelToken } = await inquirer.prompt([
    {
      type: 'password',
      name: 'vercelToken',
      message: 'Enter your Vercel API token:',
      validate: (input: string) => (input.length > 0 ? true : 'Token is required'),
    },
  ]);

  const spinner = ora('Configuring Vercel log drain...').start();

  try {
    // Get webhook URL
    const webhookUrl = await api.getWebhookUrl('/ingest/vercel');

    // Get Vercel projects
    const { data: projects } = await axios.get('https://api.vercel.com/v9/projects', {
      headers: {
        Authorization: `Bearer ${vercelToken}`,
      },
    });

    if (!projects.projects || projects.projects.length === 0) {
      spinner.warn('No Vercel projects found');
      return;
    }

    // Find matching project or let user select
    let selectedProject = projects.projects[0];

    if (projects.projects.length > 1) {
      spinner.stop();
      const { projectId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'projectId',
          message: 'Select Vercel project:',
          choices: projects.projects.map((p: { id: string; name: string }) => ({
            name: p.name,
            value: p.id,
          })),
        },
      ]);
      selectedProject = projects.projects.find((p: { id: string }) => p.id === projectId);
      spinner.start();
    }

    // Create log drain
    await axios.post(
      `https://api.vercel.com/v1/integrations/log-drains`,
      {
        name: 'ScanWarp',
        type: 'json',
        url: webhookUrl,
        projectId: selectedProject.id,
        sources: ['static', 'edge', 'lambda', 'build'],
      },
      {
        headers: {
          Authorization: `Bearer ${vercelToken}`,
        },
      }
    );

    spinner.succeed('Vercel log drain configured');
    console.log(chalk.green(`  ✓ Project: ${selectedProject.name}`));
    console.log(chalk.green(`  ✓ Drain URL: ${webhookUrl}\n`));
  } catch (error) {
    spinner.fail('Failed to configure Vercel');
    if (axios.isAxiosError(error)) {
      console.log(chalk.red(`  Error: ${error.response?.data?.error?.message || error.message}\n`));
    } else {
      console.log(chalk.red(`  Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
    }
  }
}
