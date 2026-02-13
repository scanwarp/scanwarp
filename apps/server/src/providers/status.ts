export type ProviderStatusLevel = 'operational' | 'degraded' | 'partial_outage' | 'major_outage';

export interface ProviderStatusEntry {
  provider: string;
  displayName: string;
  status: ProviderStatusLevel;
  description: string | null;
  lastCheckedAt: Date;
}

interface StatusPageConfig {
  name: string;
  displayName: string;
  url: string;
}

const PROVIDERS: StatusPageConfig[] = [
  { name: 'vercel', displayName: 'Vercel', url: 'https://www.vercel-status.com/api/v2/status.json' },
  { name: 'stripe', displayName: 'Stripe', url: 'https://status.stripe.com/api/v2/status.json' },
  { name: 'supabase', displayName: 'Supabase', url: 'https://status.supabase.com/api/v2/status.json' },
  { name: 'github', displayName: 'GitHub', url: 'https://www.githubstatus.com/api/v2/status.json' },
  { name: 'cloudflare', displayName: 'Cloudflare', url: 'https://www.cloudflarestatus.com/api/v2/status.json' },
  { name: 'railway', displayName: 'Railway', url: 'https://status.railway.app/api/v2/status.json' },
  { name: 'aws', displayName: 'AWS', url: 'https://health.aws.amazon.com/health/status' },
  { name: 'resend', displayName: 'Resend', url: 'https://status.resend.com/api/v2/status.json' },
];

/** Map Atlassian Statuspage indicator to our status levels */
function parseIndicator(indicator: string): ProviderStatusLevel {
  switch (indicator) {
    case 'none':
      return 'operational';
    case 'minor':
      return 'degraded';
    case 'major':
      return 'partial_outage';
    case 'critical':
      return 'major_outage';
    default:
      return 'operational';
  }
}

function formatStatus(status: ProviderStatusLevel): string {
  switch (status) {
    case 'operational':
      return 'operational';
    case 'degraded':
      return 'degraded performance';
    case 'partial_outage':
      return 'partial outage';
    case 'major_outage':
      return 'major outage';
  }
}

export class ProviderStatusTracker {
  private statuses = new Map<string, ProviderStatusEntry>();
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Initialize all providers as operational
    for (const p of PROVIDERS) {
      this.statuses.set(p.name, {
        provider: p.name,
        displayName: p.displayName,
        status: 'operational',
        description: null,
        lastCheckedAt: new Date(),
      });
    }

    console.log(`ProviderStatusTracker started — monitoring ${PROVIDERS.length} providers`);

    // Run first check immediately
    await this.checkAll();

    // Then every 5 minutes
    this.intervalId = setInterval(() => {
      this.checkAll().catch((err) => {
        console.error('ProviderStatusTracker check error:', err);
      });
    }, 5 * 60 * 1000);
  }

  async stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.isRunning = false;
    console.log('ProviderStatusTracker stopped');
  }

  /** All provider statuses */
  getAll(): ProviderStatusEntry[] {
    return Array.from(this.statuses.values());
  }

  /** Single provider status */
  getStatus(provider: string): ProviderStatusEntry | undefined {
    return this.statuses.get(provider);
  }

  /** Providers currently experiencing issues */
  getNonOperational(): ProviderStatusEntry[] {
    return this.getAll().filter((s) => s.status !== 'operational');
  }

  /**
   * Given a set of incident events, return the non-operational providers
   * that are likely related — either by direct source match or by name
   * appearing in event messages.
   *
   * If events don't directly mention a provider but there ARE non-operational
   * providers, returns all non-operational ones so the AI can decide relevance.
   */
  getAffectedProviders(
    events: Array<{ source: string; message: string }>
  ): ProviderStatusEntry[] {
    const nonOp = this.getNonOperational();
    if (nonOp.length === 0) return [];

    const directMatches: ProviderStatusEntry[] = [];

    for (const entry of nonOp) {
      const matched = events.some((e) => {
        // Direct source match (e.g. source: 'vercel')
        if (e.source === entry.provider) return true;
        // Provider name mentioned in the event message
        if (e.message.toLowerCase().includes(entry.provider)) return true;
        // Provider-status source events contain provider name
        if (e.source === 'provider-status' && e.message.toLowerCase().includes(entry.provider)) return true;
        return false;
      });

      if (matched) {
        directMatches.push(entry);
      }
    }

    // If no direct match, return all non-operational so AI can assess relevance
    return directMatches.length > 0 ? directMatches : nonOp;
  }

  /** Human-readable status string (e.g. "Vercel is experiencing a partial outage") */
  static formatEntry(entry: ProviderStatusEntry): string {
    if (entry.status === 'operational') {
      return `${entry.displayName} is operational`;
    }
    const statusText = formatStatus(entry.status);
    const detail = entry.description ? ` — ${entry.description}` : '';
    return `${entry.displayName} is experiencing ${statusText}${detail}`;
  }

  // ── Internal ──

  private async checkAll() {
    const results = await Promise.allSettled(
      PROVIDERS.map((p) => this.checkProvider(p))
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        // Graceful failure: assume operational when status page is unreachable
        this.setOperational(PROVIDERS[i]);
      }
    }
  }

  private async checkProvider(provider: StatusPageConfig) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(provider.url, {
        headers: { 'User-Agent': 'ScanWarp ProviderStatusTracker' },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        // Graceful failure
        this.setOperational(provider);
        return;
      }

      const data = (await res.json()) as {
        status?: { indicator?: string; description?: string };
      };

      const indicator = data?.status?.indicator || 'none';
      const description = data?.status?.description || null;

      this.statuses.set(provider.name, {
        provider: provider.name,
        displayName: provider.displayName,
        status: parseIndicator(indicator),
        description,
        lastCheckedAt: new Date(),
      });
    } catch {
      // Graceful failure: assume operational when unreachable
      this.setOperational(provider);
    }
  }

  private setOperational(provider: StatusPageConfig) {
    this.statuses.set(provider.name, {
      provider: provider.name,
      displayName: provider.displayName,
      status: 'operational',
      description: null,
      lastCheckedAt: new Date(),
    });
  }
}
