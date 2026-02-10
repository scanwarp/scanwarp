import inquirer from 'inquirer';
import chalk from 'chalk';

export async function setupNotifications() {
  const { notificationType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'notificationType',
      message: 'Where should alerts go?',
      choices: [
        { name: 'Discord webhook', value: 'discord' },
        { name: 'Slack webhook', value: 'slack' },
        { name: 'Skip for now', value: 'skip' },
      ],
    },
  ]);

  if (notificationType === 'skip') {
    console.log(chalk.gray('  Skipped\n'));
    return;
  }

  const { webhookUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'webhookUrl',
      message: `Enter your ${notificationType === 'discord' ? 'Discord' : 'Slack'} webhook URL:`,
      validate: (input: string) => {
        try {
          new URL(input);
          return true;
        } catch {
          return 'Please enter a valid URL';
        }
      },
    },
  ]);

  console.log(chalk.green('\n  ✓ Webhook configured\n'));
  console.log(chalk.yellow('  Add this to your server .env file:\n'));
  console.log(chalk.cyan(`  ${notificationType.toUpperCase()}_WEBHOOK_URL=${webhookUrl}\n`));

  console.log(chalk.gray('  Note: Notification delivery will be implemented in a future update.\n'));
}
