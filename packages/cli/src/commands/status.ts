import chalk from 'chalk';
import ora from 'ora';
import { ScanWarpAPI } from '../api.js';

interface Monitor {
  id: string;
  url: string;
  status: 'up' | 'down' | 'unknown';
  last_checked_at?: string;
  check_interval_seconds: number;
}

interface Incident {
  id: string;
  severity: string;
  status: string;
  diagnosis_text?: string;
  created_at: string;
}

interface StatusOptions {
  server?: string;
}

export async function statusCommand(options: StatusOptions = {}) {
  const serverUrl = options.server || 'http://localhost:3000';
  const api = new ScanWarpAPI(serverUrl);

  const spinner = ora('Fetching status...').start();

  try {
    // Fetch monitors and incidents
    const [monitorsResponse, incidentsResponse] = await Promise.all([
      api.client.get('/monitors'),
      api.client.get('/incidents', { params: { status: 'open' } }),
    ]);

    spinner.stop();

    const monitors = monitorsResponse.data.monitors as Monitor[];
    const incidents = incidentsResponse.data.incidents as Incident[];

    // Print header
    console.log(chalk.bold.cyan('\n📊 ScanWarp Status\n'));

    // Print monitors
    if (monitors.length === 0) {
      console.log(chalk.yellow('No monitors configured yet.'));
      console.log(chalk.gray('Run "scanwarp init" to set up monitoring.\n'));
      return;
    }

    console.log(chalk.bold('Monitors:\n'));

    for (const monitor of monitors) {
      const statusIcon = getStatusIcon(monitor.status);
      const statusColor = getStatusColor(monitor.status);
      const lastChecked = monitor.last_checked_at
        ? formatRelativeTime(new Date(monitor.last_checked_at))
        : 'never';

      console.log(`  ${statusIcon} ${chalk[statusColor](monitor.status.toUpperCase().padEnd(7))} ${monitor.url}`);
      console.log(chalk.gray(`     Last checked: ${lastChecked} • Every ${monitor.check_interval_seconds}s`));
    }

    // Print summary
    const upCount = monitors.filter((m) => m.status === 'up').length;
    const downCount = monitors.filter((m) => m.status === 'down').length;
    const unknownCount = monitors.filter((m) => m.status === 'unknown').length;

    console.log(chalk.bold(`\nSummary: ${monitors.length} total`));
    if (upCount > 0) console.log(chalk.green(`  ✓ ${upCount} up`));
    if (downCount > 0) console.log(chalk.red(`  ✗ ${downCount} down`));
    if (unknownCount > 0) console.log(chalk.gray(`  ? ${unknownCount} unknown`));

    // Print active incidents
    if (incidents.length > 0) {
      console.log(chalk.bold.red(`\n⚠ ${incidents.length} Active Incident${incidents.length > 1 ? 's' : ''}:\n`));

      for (const incident of incidents) {
        const severityIcon = getSeverityIcon(incident.severity);
        const severityColor = getSeverityColor(incident.severity);

        console.log(`  ${severityIcon} ${chalk[severityColor](incident.severity.toUpperCase())} • ${incident.status}`);
        if (incident.diagnosis_text) {
          const preview = incident.diagnosis_text.substring(0, 80);
          console.log(chalk.gray(`     ${preview}${incident.diagnosis_text.length > 80 ? '...' : ''}`));
        }
        console.log(chalk.gray(`     Created: ${formatRelativeTime(new Date(incident.created_at))}`));
        console.log(chalk.gray(`     View: scanwarp incidents\n`));
      }
    } else {
      console.log(chalk.green('\n✓ No active incidents'));
    }

    console.log(chalk.gray(`\nServer: ${serverUrl}\n`));
  } catch (error) {
    spinner.fail('Failed to fetch status');

    if (error instanceof Error && 'code' in error && error.code === 'ECONNREFUSED') {
      console.log(chalk.red('\n✗ Could not connect to ScanWarp server'));
      console.log(chalk.gray(`  Server: ${serverUrl}`));
      console.log(chalk.yellow('  Make sure the server is running.\n'));
    } else {
      console.log(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
    }

    process.exit(1);
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'up':
      return chalk.green('●');
    case 'down':
      return chalk.red('●');
    default:
      return chalk.gray('●');
  }
}

function getStatusColor(status: string): 'green' | 'red' | 'yellow' | 'gray' {
  switch (status) {
    case 'up':
      return 'green';
    case 'down':
      return 'red';
    default:
      return 'gray';
  }
}

function getSeverityIcon(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical':
      return '🚨';
    case 'warning':
      return '⚠️';
    default:
      return 'ℹ️';
  }
}

function getSeverityColor(severity: string): 'red' | 'yellow' | 'blue' {
  switch (severity.toLowerCase()) {
    case 'critical':
      return 'red';
    case 'warning':
      return 'yellow';
    default:
      return 'blue';
  }
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}
