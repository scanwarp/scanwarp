import type { Database } from '../db/index.js';
import type { Monitor, Event } from '@scanwarp/core';
import { validateURLWithDNS } from '../utils/url-validation.js';

interface CheckResult {
  success: boolean;
  responseTime: number;
  statusCode?: number;
  error?: string;
}

export class MonitorRunner {
  private db: Database;
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;

  constructor(db: Database) {
    this.db = db;
  }

  async start() {
    if (this.isRunning) {
      console.log('MonitorRunner already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting MonitorRunner...');

    // Run checks immediately on start
    await this.runChecks();

    // Then run every 60 seconds
    this.intervalId = setInterval(() => {
      this.runChecks().catch((err) => {
        console.error('Error in monitor checks:', err);
      });
    }, 60_000);
  }

  async stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.isRunning = false;
    console.log('MonitorRunner stopped');
  }

  private async runChecks() {
    const monitors = await this.loadMonitors();

    if (monitors.length === 0) {
      console.log('No monitors configured');
      return;
    }

    console.log(`Checking ${monitors.length} monitor(s)...`);

    // Run checks concurrently in batches of 10
    const concurrency = 10;
    for (let i = 0; i < monitors.length; i += concurrency) {
      const batch = monitors.slice(i, i + concurrency);
      await Promise.allSettled(batch.map((monitor) => this.checkMonitor(monitor)));
    }
  }

  private async loadMonitors(): Promise<Monitor[]> {
    const rows = await this.db.getMonitors();

    return rows.map((row) => ({
      ...row,
      status: row.status as Monitor['status'],
      last_checked_at: row.last_checked_at ? new Date(row.last_checked_at) : undefined,
      created_at: new Date(row.created_at),
    }));
  }

  private async checkMonitor(monitor: Monitor) {
    const result = await this.performCheck(monitor.url);

    // Update monitor status and last_checked_at
    const newStatus = result.success ? 'up' : 'down';
    await this.db.updateMonitorStatus(monitor.id, newStatus);

    // Update statistics
    await this.updateStats(monitor.id, result);

    // Detect anomalies and create events
    await this.detectAndCreateEvents(monitor, result, newStatus);
  }

  private async performCheck(url: string): Promise<CheckResult> {
    // SSRF protection: validate URL before making request
    const urlCheck = await validateURLWithDNS(url);
    if (!urlCheck.valid) {
      return {
        success: false,
        responseTime: 0,
        error: `URL blocked: ${urlCheck.error}`,
      };
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        method: 'GET',
      });

      clearTimeout(timeout);
      const responseTime = Date.now() - startTime;

      return {
        success: response.status >= 200 && response.status < 300,
        responseTime,
        statusCode: response.status,
      };
    } catch (error) {
      clearTimeout(timeout);
      const responseTime = Date.now() - startTime;

      return {
        success: false,
        responseTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async updateStats(monitorId: string, result: CheckResult) {
    const stats = await this.db.getEventStats(monitorId);

    if (!stats) {
      // Create new stats
      await this.db.createEventStats(monitorId, result.responseTime, !result.success);
    } else {
      // Update existing stats with rolling average
      const totalChecks = stats.total_checks + 1;
      const currentAvg = stats.avg_response_time || 0;
      const newAvg = (currentAvg * stats.total_checks + result.responseTime) / totalChecks;

      await this.db.updateEventStats(
        monitorId,
        newAvg,
        totalChecks,
        stats.error_count + (result.success ? 0 : 1),
        !result.success
      );
    }
  }

  private async detectAndCreateEvents(
    monitor: Monitor,
    result: CheckResult,
    newStatus: 'up' | 'down'
  ) {
    const events: Array<{ type: Event['type']; message: string; severity: Event['severity'] }> = [];

    // Check for down -> up transition
    if (monitor.status === 'down' && newStatus === 'up') {
      events.push({
        type: 'up',
        message: `Monitor ${monitor.url} is back up`,
        severity: 'low',
      });
    }

    // Check for down status
    if (!result.success) {
      events.push({
        type: 'down',
        message: `Monitor ${monitor.url} is down: ${result.error || `HTTP ${result.statusCode}`}`,
        severity: 'critical',
      });
    }

    // Check for slow response (3x higher than average)
    if (result.success) {
      const avgTime = await this.db.getAvgResponseTime(monitor.id);

      if (avgTime) {
        if (result.responseTime > avgTime * 3) {
          events.push({
            type: 'slow',
            message: `Monitor ${monitor.url} is slow: ${result.responseTime}ms (avg: ${Math.round(avgTime)}ms)`,
            severity: 'medium',
          });
        }
      }
    }

    // Create events in database
    for (const event of events) {
      await this.db.createEvent({
        project_id: monitor.project_id,
        monitor_id: monitor.id,
        type: event.type,
        source: 'monitor',
        message: event.message,
        raw_data: {
          url: monitor.url,
          responseTime: result.responseTime,
          statusCode: result.statusCode,
          error: result.error,
        },
        severity: event.severity,
      });

      console.log(`Event created: ${event.type} - ${event.message}`);
    }
  }
}
