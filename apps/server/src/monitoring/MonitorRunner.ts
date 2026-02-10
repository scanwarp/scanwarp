import type postgres from 'postgres';
import type { Monitor, Event } from '@scanwarp/core';

interface CheckResult {
  success: boolean;
  responseTime: number;
  statusCode?: number;
  error?: string;
}

export class MonitorRunner {
  private sql: postgres.Sql;
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;

  constructor(sql: postgres.Sql) {
    this.sql = sql;
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

    for (const monitor of monitors) {
      await this.checkMonitor(monitor);
    }
  }

  private async loadMonitors(): Promise<Monitor[]> {
    const rows = await this.sql<Monitor[]>`
      SELECT * FROM monitors
      ORDER BY created_at DESC
    `;

    return rows.map((row) => ({
      ...row,
      last_checked_at: row.last_checked_at ? new Date(row.last_checked_at) : undefined,
      created_at: new Date(row.created_at),
    }));
  }

  private async checkMonitor(monitor: Monitor) {
    const result = await this.performCheck(monitor.url);

    // Update monitor status and last_checked_at
    const newStatus = result.success ? 'up' : 'down';
    await this.sql`
      UPDATE monitors
      SET status = ${newStatus}, last_checked_at = NOW()
      WHERE id = ${monitor.id}
    `;

    // Update statistics
    await this.updateStats(monitor.id, result);

    // Detect anomalies and create events
    await this.detectAndCreateEvents(monitor, result, newStatus);
  }

  private async performCheck(url: string): Promise<CheckResult> {
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
    const existingStats = await this.sql<Array<{
      monitor_id: string;
      avg_response_time: number | null;
      total_checks: number;
      error_count: number;
    }>>`
      SELECT * FROM event_stats WHERE monitor_id = ${monitorId}
    `;

    if (existingStats.length === 0) {
      // Create new stats
      await this.sql`
        INSERT INTO event_stats (
          monitor_id, avg_response_time, total_checks, error_count, updated_at
        ) VALUES (
          ${monitorId},
          ${result.responseTime},
          1,
          ${result.success ? 0 : 1},
          NOW()
        )
      `;
    } else {
      // Update existing stats with rolling average
      const stats = existingStats[0];
      const totalChecks = stats.total_checks + 1;
      const currentAvg = stats.avg_response_time || 0;
      const newAvg = (currentAvg * stats.total_checks + result.responseTime) / totalChecks;

      await this.sql`
        UPDATE event_stats
        SET
          avg_response_time = ${newAvg},
          total_checks = ${totalChecks},
          error_count = ${stats.error_count + (result.success ? 0 : 1)},
          ${!result.success ? this.sql`last_error_at = NOW(),` : this.sql``}
          updated_at = NOW()
        WHERE monitor_id = ${monitorId}
      `;
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
      const stats = await this.sql<Array<{
        avg_response_time: number | null;
      }>>`
        SELECT avg_response_time FROM event_stats WHERE monitor_id = ${monitor.id}
      `;

      if (stats.length > 0 && stats[0].avg_response_time) {
        const avgTime = stats[0].avg_response_time;
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
      await this.sql`
        INSERT INTO events (
          project_id, monitor_id, type, source, message, raw_data, severity, created_at
        ) VALUES (
          ${monitor.project_id},
          ${monitor.id},
          ${event.type},
          'monitor',
          ${event.message},
          ${JSON.stringify({
            url: monitor.url,
            responseTime: result.responseTime,
            statusCode: result.statusCode,
            error: result.error,
          })},
          ${event.severity},
          NOW()
        )
      `;

      console.log(`Event created: ${event.type} - ${event.message}`);
    }
  }
}
