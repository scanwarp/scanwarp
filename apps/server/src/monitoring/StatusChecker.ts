import type { Database } from '../db/index.js';

interface ProviderStatusPage {
  name: string;
  url: string;
  parser: (data: unknown) => { status: 'operational' | 'degraded' | 'outage'; details?: string };
}

const STATUS_PAGES: ProviderStatusPage[] = [
  {
    name: 'vercel',
    url: 'https://www.vercel-status.com/api/v2/status.json',
    parser: (data: unknown) => {
      const json = data as { status?: { indicator?: string; description?: string } };
      const indicator = json.status?.indicator || 'none';

      if (indicator === 'none' || indicator === 'operational') {
        return { status: 'operational' };
      } else if (indicator === 'minor' || indicator === 'major') {
        return { status: 'degraded', details: json.status?.description };
      } else {
        return { status: 'outage', details: json.status?.description };
      }
    },
  },
  {
    name: 'github',
    url: 'https://www.githubstatus.com/api/v2/status.json',
    parser: (data: unknown) => {
      const json = data as { status?: { indicator?: string; description?: string } };
      const indicator = json.status?.indicator || 'none';

      if (indicator === 'none') {
        return { status: 'operational' };
      } else if (indicator === 'minor') {
        return { status: 'degraded', details: json.status?.description };
      } else {
        return { status: 'outage', details: json.status?.description };
      }
    },
  },
  {
    name: 'stripe',
    url: 'https://status.stripe.com/api/v2/status.json',
    parser: (data: unknown) => {
      const json = data as { status?: { indicator?: string; description?: string } };
      const indicator = json.status?.indicator || 'none';

      if (indicator === 'none') {
        return { status: 'operational' };
      } else if (indicator === 'minor') {
        return { status: 'degraded', details: json.status?.description };
      } else {
        return { status: 'outage', details: json.status?.description };
      }
    },
  },
  {
    name: 'cloudflare',
    url: 'https://www.cloudflarestatus.com/api/v2/status.json',
    parser: (data: unknown) => {
      const json = data as { status?: { indicator?: string; description?: string } };
      const indicator = json.status?.indicator || 'none';

      if (indicator === 'none') {
        return { status: 'operational' };
      } else if (indicator === 'minor') {
        return { status: 'degraded', details: json.status?.description };
      } else {
        return { status: 'outage', details: json.status?.description };
      }
    },
  },
  {
    name: 'supabase',
    url: 'https://status.supabase.com/api/v2/status.json',
    parser: (data: unknown) => {
      const json = data as { status?: { indicator?: string; description?: string } };
      const indicator = json.status?.indicator || 'none';

      if (indicator === 'none') {
        return { status: 'operational' };
      } else if (indicator === 'minor') {
        return { status: 'degraded', details: json.status?.description };
      } else {
        return { status: 'outage', details: json.status?.description };
      }
    },
  },
];

export class StatusChecker {
  private db: Database;
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;

  constructor(db: Database) {
    this.db = db;
  }

  async start() {
    if (this.isRunning) {
      console.log('StatusChecker already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting StatusChecker...');

    // Run checks immediately on start
    await this.runChecks();

    // Then run every 5 minutes
    this.intervalId = setInterval(() => {
      this.runChecks().catch((err) => {
        console.error('Error in status checks:', err);
      });
    }, 5 * 60 * 1000);
  }

  async stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.isRunning = false;
    console.log('StatusChecker stopped');
  }

  private async runChecks() {
    for (const provider of STATUS_PAGES) {
      try {
        await this.checkProvider(provider);
      } catch (error) {
        console.error(`Failed to check ${provider.name} status:`, error);
      }
    }
  }

  private async checkProvider(provider: ProviderStatusPage) {
    try {
      const response = await fetch(provider.url, {
        headers: {
          'User-Agent': 'ScanWarp Status Checker',
        },
      });

      if (!response.ok) {
        console.warn(`Failed to fetch ${provider.name} status: ${response.statusText}`);
        return;
      }

      const data = await response.json();
      const { status, details } = provider.parser(data);

      // Update provider_status table
      await this.db.upsertProviderStatus(provider.name, status, details || null);

      // If status is not operational, create an event
      if (status !== 'operational') {
        await this.createProviderEvent(provider.name, status, details);
      }

      console.log(`${provider.name} status: ${status}`);
    } catch (error) {
      console.error(`Error checking ${provider.name}:`, error);
    }
  }

  private async createProviderEvent(
    provider: string,
    status: 'degraded' | 'outage',
    details?: string
  ) {
    // Check if we already have a recent event for this provider
    const hasRecent = await this.db.hasRecentProviderEvent(provider);

    if (hasRecent) return;

    const { id: projectId } = await this.db.getOrCreateProject('provider-status');

    const message =
      status === 'outage'
        ? `${provider} is experiencing an outage`
        : `${provider} is experiencing degraded performance`;

    await this.db.createEvent({
      project_id: projectId,
      type: 'error',
      source: 'provider-status',
      message,
      raw_data: { provider, status, details },
      severity: status === 'outage' ? 'critical' : 'high',
    });

    console.log(`Provider status event created: ${message}`);
  }

  async getProviderStatuses() {
    return await this.db.getProviderStatuses();
  }
}
