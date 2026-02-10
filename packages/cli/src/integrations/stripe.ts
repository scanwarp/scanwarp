import chalk from 'chalk';
import type { ScanWarpAPI } from '../api.js';

export async function setupStripe(api: ScanWarpAPI) {
  console.log(chalk.bold('Stripe Webhooks'));

  const webhookUrl = await api.getWebhookUrl('/ingest/stripe');

  console.log(chalk.yellow('\n  ⚠ Manual setup required:\n'));
  console.log(chalk.gray('  1. Go to https://dashboard.stripe.com/webhooks'));
  console.log(chalk.gray('  2. Click "Add endpoint"'));
  console.log(chalk.gray(`  3. Enter URL: ${chalk.cyan(webhookUrl)}`));
  console.log(chalk.gray('  4. Select these events:'));
  console.log(chalk.gray('     • payment_intent.payment_failed'));
  console.log(chalk.gray('     • charge.failed'));
  console.log(chalk.gray('     • checkout.session.expired'));
  console.log(chalk.gray('     • invoice.payment_failed'));
  console.log(chalk.gray('     • customer.subscription.deleted'));
  console.log(chalk.gray('  5. Save the webhook signing secret to your .env:\n'));
  console.log(chalk.cyan('     STRIPE_WEBHOOK_SECRET=whsec_...\n'));

  console.log(chalk.gray('  Press Enter to continue...'));
  await new Promise((resolve) => process.stdin.once('data', resolve));
}
