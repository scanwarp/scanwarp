import chalk from 'chalk';
import ora from 'ora';
import { ScanWarpAPI } from '../api.js';

interface Event {
  id: string;
  type: string;
  source: string;
  message: string;
  severity: string;
  created_at: string;
  monitor_id?: string;
}

interface LogsOptions {
  server?: string;
  follow?: boolean;
  type?: string;
  source?: string;
  limit?: number;
}

export async function logsCommand(options: LogsOptions = {}) {
  const serverUrl = options.server || 'http://localhost:3000';
  const api = new ScanWarpAPI(serverUrl);
  const limit = options.limit || 50;

  if (options.follow) {
    await streamLogs(api, options);
  } else {
    await fetchLogs(api, { ...options, limit });
  }
}

async function fetchLogs(api: ScanWarpAPI, options: LogsOptions) {
  const spinner = ora('Fetching events...').start();

  try {
    const params: Record<string, unknown> = {
      limit: options.limit,
    };

    if (options.type) {
      params.type = options.type;
    }

    if (options.source) {
      params.source = options.source;
    }

    const response = await api.client.get('/events', { params });
    spinner.stop();

    const events = response.data.events as Event[];

    if (events.length === 0) {
      console.log(chalk.yellow('\nNo events found.\n'));
      return;
    }

    console.log(chalk.bold.cyan(`\n📋 Recent Events (${events.length})\n`));

    // Reverse to show oldest first
    events.reverse();

    for (const event of events) {
      printEvent(event);
    }

    console.log(chalk.gray(`\nShowing ${events.length} events`));
    console.log(chalk.gray('Use --follow to stream live events\n'));
  } catch (error) {
    spinner.fail('Failed to fetch events');
    console.log(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
    process.exit(1);
  }
}

async function streamLogs(api: ScanWarpAPI, options: LogsOptions) {
  console.log(chalk.bold.cyan('\n📡 Streaming events (Ctrl+C to stop)\n'));

  let lastEventId: string | null = null;
  let isFirstFetch = true;

  const poll = async () => {
    try {
      const params: Record<string, unknown> = {
        limit: 20,
      };

      if (options.type) {
        params.type = options.type;
      }

      if (options.source) {
        params.source = options.source;
      }

      const response = await api.client.get('/events', { params });
      const events = response.data.events as Event[];

      // Filter to only show new events
      let newEvents = events;
      if (lastEventId) {
        const lastIndex = events.findIndex((e) => e.id === lastEventId);
        if (lastIndex > -1) {
          newEvents = events.slice(0, lastIndex);
        }
      }

      if (newEvents.length > 0) {
        if (!isFirstFetch) {
          // Show new events (they come in reverse chronological order)
          for (let i = newEvents.length - 1; i >= 0; i--) {
            printEvent(newEvents[i]);
          }
        } else {
          // On first fetch, show the most recent event
          printEvent(newEvents[0]);
          isFirstFetch = false;
        }

        lastEventId = newEvents[0].id;
      }
    } catch (error) {
      console.log(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  };

  // Initial fetch
  await poll();

  // Poll every 2 seconds
  const intervalId = setInterval(poll, 2000);

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(intervalId);
    console.log(chalk.gray('\n\nStopped streaming.\n'));
    process.exit(0);
  });
}

function printEvent(event: Event) {
  const timestamp = new Date(event.created_at).toLocaleTimeString();
  const severityColor = getSeverityColor(event.severity);
  const typeIcon = getTypeIcon(event.type);
  const sourceTag = chalk.gray(`[${event.source}]`);

  console.log(
    `${chalk.gray(timestamp)} ${typeIcon} ${chalk[severityColor](event.severity.toUpperCase().padEnd(8))} ${sourceTag} ${event.message}`
  );
}

function getSeverityColor(severity: string): 'red' | 'yellow' | 'blue' | 'green' | 'gray' {
  switch (severity.toLowerCase()) {
    case 'critical':
      return 'red';
    case 'high':
      return 'red';
    case 'medium':
      return 'yellow';
    case 'low':
      return 'blue';
    default:
      return 'gray';
  }
}

function getTypeIcon(type: string): string {
  switch (type.toLowerCase()) {
    case 'error':
      return '✗';
    case 'down':
      return '↓';
    case 'up':
      return '↑';
    case 'slow':
      return '⚠';
    default:
      return '•';
  }
}
