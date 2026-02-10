import type postgres from 'postgres';

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
  private sql: postgres.Sql;
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;

  constructor(sql: postgres.Sql) {
    this.sql = sql;
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
      await this.sql`
        INSERT INTO provider_status (provider, status, last_checked_at, details)
        VALUES (${provider.name}, ${status}, NOW(), ${details || null})
        ON CONFLICT (provider)
        DO UPDATE SET
          status = EXCLUDED.status,
          last_checked_at = EXCLUDED.last_checked_at,
          details = EXCLUDED.details
      `;

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
    const recentEvents = await this.sql`
      SELECT id FROM events
      WHERE source = 'provider-status'
        AND raw_data->>'provider' = ${provider}
        AND created_at > NOW() - INTERVAL '10 minutes'
      LIMIT 1
    `;

    if (recentEvents.length > 0) {
      // Don't spam events
      return;
    }

    const projectId = await this.getOrCreateProject();

    const message =
      status === 'outage'
        ? `${provider} is experiencing an outage`
        : `${provider} is experiencing degraded performance`;

    await this.sql`
      INSERT INTO events (
        project_id, type, source, message, raw_data, severity, created_at
      ) VALUES (
        ${projectId},
        'error',
        'provider-status',
        ${message},
        ${JSON.stringify({ provider, status, details })},
        ${status === 'outage' ? 'critical' : 'high'},
        NOW()
      )
    `;

    console.log(`Provider status event created: ${message}`);
  }

  private async getOrCreateProject(): Promise<string> {
    const projectName = 'provider-status';

    const existing = await this.sql<Array<{ id: string }>>`
      SELECT id FROM projects WHERE name = ${projectName}
    `;

    if (existing.length > 0) {
      return existing[0].id;
    }

    const created = await this.sql<Array<{ id: string }>>`
      INSERT INTO projects (name) VALUES (${projectName}) RETURNING id
    `;

    return created[0].id;
  }

  async getProviderStatuses() {
    return await this.sql`
      SELECT provider, status, last_checked_at, details
      FROM provider_status
      ORDER BY provider
    `;
  }
}
