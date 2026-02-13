/**
 * PostgreSQL implementation of the Database interface.
 * Wraps the existing postgres.js driver.
 */

import postgres from 'postgres';
import type {
  Database,
  ProjectRow,
  MonitorRow,
  EventRow,
  EventStatsRow,
  IncidentRow,
  SpanRow,
  ProviderStatusRow,
  NotificationChannelRow,
  WaitlistRow,
  EventFilters,
  IncidentFilters,
} from './index.js';

interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

export class PostgresDatabase implements Database {
  private sql: postgres.Sql;

  constructor(config: PostgresConfig) {
    this.sql = postgres(config);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  // ─── Projects ───

  async createProject(name: string): Promise<{ id: string }> {
    const rows = await this.sql<Array<{ id: string }>>`
      INSERT INTO projects (name) VALUES (${name}) RETURNING id
    `;
    return { id: rows[0].id };
  }

  async getProjects(name?: string): Promise<ProjectRow[]> {
    if (name) {
      return this.sql<ProjectRow[]>`SELECT * FROM projects WHERE name = ${name}`;
    }
    return this.sql<ProjectRow[]>`SELECT * FROM projects`;
  }

  async getOrCreateProject(name: string): Promise<{ id: string }> {
    const existing = await this.sql<Array<{ id: string }>>`
      SELECT id FROM projects WHERE name = ${name}
    `;
    if (existing.length > 0) return { id: existing[0].id };

    const created = await this.sql<Array<{ id: string }>>`
      INSERT INTO projects (name) VALUES (${name}) RETURNING id
    `;
    return { id: created[0].id };
  }

  // ─── Monitors ───

  async createMonitor(projectId: string, url: string, checkIntervalSeconds: number): Promise<MonitorRow> {
    const rows = await this.sql<MonitorRow[]>`
      INSERT INTO monitors (project_id, url, check_interval_seconds)
      VALUES (${projectId}, ${url}, ${checkIntervalSeconds})
      RETURNING *
    `;
    return rows[0];
  }

  async getMonitors(): Promise<MonitorRow[]> {
    return this.sql<MonitorRow[]>`SELECT * FROM monitors ORDER BY created_at DESC`;
  }

  async getMonitorById(id: string): Promise<MonitorRow | null> {
    const rows = await this.sql<MonitorRow[]>`SELECT * FROM monitors WHERE id = ${id}`;
    return rows[0] || null;
  }

  async updateMonitorStatus(id: string, status: string): Promise<void> {
    await this.sql`UPDATE monitors SET status = ${status}, last_checked_at = NOW() WHERE id = ${id}`;
  }

  // ─── Events ───

  async createEvent(params: {
    project_id: string;
    monitor_id?: string | null;
    type: string;
    source: string;
    message: string;
    raw_data?: Record<string, unknown> | null;
    severity: string;
  }): Promise<EventRow> {
    const rows = await this.sql<EventRow[]>`
      INSERT INTO events (project_id, monitor_id, type, source, message, raw_data, severity, created_at)
      VALUES (
        ${params.project_id},
        ${params.monitor_id || null},
        ${params.type},
        ${params.source},
        ${params.message},
        ${params.raw_data ? JSON.stringify(params.raw_data) : null},
        ${params.severity},
        NOW()
      )
      RETURNING *
    `;
    return rows[0];
  }

  async getEvents(filters: EventFilters): Promise<EventRow[]> {
    const { monitor_id, project_id, type, source, limit = 100 } = filters;

    let query = this.sql`SELECT * FROM events WHERE 1=1`;
    if (monitor_id) query = this.sql`${query} AND monitor_id = ${monitor_id}`;
    if (project_id) query = this.sql`${query} AND project_id = ${project_id}`;
    if (type) query = this.sql`${query} AND type = ${type}`;
    if (source) query = this.sql`${query} AND source = ${source}`;

    return this.sql<EventRow[]>`${query} ORDER BY created_at DESC LIMIT ${limit}`;
  }

  async getEventsByIds(ids: string[]): Promise<EventRow[]> {
    if (ids.length === 0) return [];
    return this.sql<EventRow[]>`SELECT * FROM events WHERE id = ANY(${ids})`;
  }

  async flagEventForDiagnosis(eventId: string, reason: string): Promise<void> {
    await this.sql`
      UPDATE events
      SET raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object(
        'flagged_for_diagnosis', true,
        'diagnosis_reason', ${reason}
      )
      WHERE id = ${eventId}
    `;
  }

  // ─── Event Statistics ───

  async getEventStats(monitorId: string): Promise<EventStatsRow | null> {
    const rows = await this.sql<EventStatsRow[]>`
      SELECT * FROM event_stats WHERE monitor_id = ${monitorId}
    `;
    return rows[0] || null;
  }

  async createEventStats(monitorId: string, avgResponseTime: number, isError: boolean): Promise<void> {
    await this.sql`
      INSERT INTO event_stats (monitor_id, avg_response_time, total_checks, error_count, updated_at)
      VALUES (${monitorId}, ${avgResponseTime}, 1, ${isError ? 1 : 0}, NOW())
    `;
  }

  async updateEventStats(monitorId: string, newAvg: number, totalChecks: number, errorCount: number, isError: boolean): Promise<void> {
    if (isError) {
      await this.sql`
        UPDATE event_stats
        SET avg_response_time = ${newAvg}, total_checks = ${totalChecks},
            error_count = ${errorCount}, last_error_at = NOW(), updated_at = NOW()
        WHERE monitor_id = ${monitorId}
      `;
    } else {
      await this.sql`
        UPDATE event_stats
        SET avg_response_time = ${newAvg}, total_checks = ${totalChecks},
            error_count = ${errorCount}, updated_at = NOW()
        WHERE monitor_id = ${monitorId}
      `;
    }
  }

  async getAvgResponseTime(monitorId: string): Promise<number | null> {
    const rows = await this.sql<Array<{ avg_response_time: number | null }>>`
      SELECT avg_response_time FROM event_stats WHERE monitor_id = ${monitorId}
    `;
    return rows[0]?.avg_response_time ?? null;
  }

  // ─── Anomaly Detection ───

  async getSimilarErrorCount(monitorId: string, eventId: string, pattern: string): Promise<number> {
    const rows = await this.sql<Array<{ count: number }>>`
      SELECT COUNT(*) as count FROM events
      WHERE monitor_id = ${monitorId}
        AND type IN ('error', 'down')
        AND message ILIKE ${`%${pattern}%`}
        AND id != ${eventId}
        AND created_at > NOW() - INTERVAL '7 days'
    `;
    return rows[0]?.count || 0;
  }

  async getRecentErrorCount(monitorId: string): Promise<number> {
    const rows = await this.sql<Array<{ count: number }>>`
      SELECT COUNT(*) as count FROM events
      WHERE monitor_id = ${monitorId}
        AND type IN ('error', 'down')
        AND created_at > NOW() - INTERVAL '1 hour'
    `;
    return rows[0]?.count || 0;
  }

  async getBaselineErrorRate(monitorId: string): Promise<number> {
    const rows = await this.sql<Array<{ avg_per_hour: number }>>`
      SELECT
        COUNT(*)::NUMERIC / NULLIF(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))), 0) * 3600 as avg_per_hour
      FROM events
      WHERE monitor_id = ${monitorId}
        AND type IN ('error', 'down')
        AND created_at > NOW() - INTERVAL '7 days'
        AND created_at < NOW() - INTERVAL '1 hour'
    `;
    return rows[0]?.avg_per_hour || 0;
  }

  // ─── Incidents ───

  async createIncident(projectId: string, eventIds: string[], severity: string): Promise<{ id: string }> {
    const rows = await this.sql<Array<{ id: string }>>`
      INSERT INTO incidents (project_id, events, status, severity, created_at)
      VALUES (${projectId}, ${JSON.stringify(eventIds)}, 'open', ${severity}, NOW())
      RETURNING id
    `;
    return { id: rows[0].id };
  }

  async getIncident(id: string): Promise<IncidentRow | null> {
    const rows = await this.sql<IncidentRow[]>`SELECT * FROM incidents WHERE id = ${id}`;
    return rows[0] || null;
  }

  async getIncidents(filters: IncidentFilters): Promise<IncidentRow[]> {
    const { project_id, status, limit = 50 } = filters;
    let query = this.sql`SELECT * FROM incidents WHERE 1=1`;
    if (project_id) query = this.sql`${query} AND project_id = ${project_id}`;
    if (status) query = this.sql`${query} AND status = ${status}`;
    return this.sql<IncidentRow[]>`${query} ORDER BY created_at DESC LIMIT ${limit}`;
  }

  async updateIncidentDiagnosis(id: string, diagnosis: {
    root_cause: string; suggested_fix: string; fix_prompt: string; severity: string;
  }): Promise<void> {
    await this.sql`
      UPDATE incidents
      SET diagnosis_text = ${diagnosis.root_cause}, diagnosis_fix = ${diagnosis.suggested_fix},
          fix_prompt = ${diagnosis.fix_prompt}, severity = ${diagnosis.severity}, status = 'investigating'
      WHERE id = ${id}
    `;
  }

  async resolveIncident(id: string): Promise<void> {
    await this.sql`UPDATE incidents SET status = 'resolved', resolved_at = NOW() WHERE id = ${id}`;
  }

  async getRecentEventHistory(monitorId: string): Promise<Array<{ created_at: Date; type: string; message: string }>> {
    return this.sql`
      SELECT created_at, type, message FROM events
      WHERE monitor_id = ${monitorId} AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC LIMIT 20
    `;
  }

  // ─── Spans ───

  async insertSpan(params: {
    trace_id: string; span_id: string; parent_span_id: string | null;
    project_id: string; service_name: string; operation_name: string; kind: string;
    start_time: number; duration_ms: number; status_code: string;
    status_message: string | null; attributes: Record<string, unknown>; events: unknown[];
  }): Promise<void> {
    await this.sql`
      INSERT INTO spans (trace_id, span_id, parent_span_id, project_id, service_name,
        operation_name, kind, start_time, duration_ms, status_code, status_message, attributes, events)
      VALUES (
        ${params.trace_id}, ${params.span_id}, ${params.parent_span_id}, ${params.project_id},
        ${params.service_name}, ${params.operation_name}, ${params.kind}, ${params.start_time},
        ${params.duration_ms}, ${params.status_code}, ${params.status_message},
        ${JSON.stringify(params.attributes)}, ${JSON.stringify(params.events)}
      )
    `;
  }

  async getSpansByTraceId(traceId: string): Promise<SpanRow[]> {
    return this.sql<SpanRow[]>`SELECT * FROM spans WHERE trace_id = ${traceId} ORDER BY start_time ASC`;
  }

  async getSpansByTraceIds(traceIds: string[], limit: number): Promise<SpanRow[]> {
    if (traceIds.length === 0) return [];
    return this.sql<SpanRow[]>`
      SELECT * FROM spans WHERE trace_id = ANY(${traceIds}) ORDER BY start_time ASC LIMIT ${limit}
    `;
  }

  async getRootSpans(projectId: string, limit: number): Promise<SpanRow[]> {
    return this.sql<SpanRow[]>`
      SELECT * FROM spans WHERE project_id = ${projectId} AND parent_span_id IS NULL
      ORDER BY start_time DESC LIMIT ${limit}
    `;
  }

  async getErrorRootSpans(projectId: string): Promise<SpanRow[]> {
    return this.sql<SpanRow[]>`
      SELECT DISTINCT ON (s.trace_id) s.*
      FROM spans s
      WHERE s.project_id = ${projectId} AND s.parent_span_id IS NULL
        AND EXISTS (SELECT 1 FROM spans e WHERE e.trace_id = s.trace_id AND e.status_code = 'ERROR')
      ORDER BY s.trace_id, s.start_time ASC
    `;
  }

  async getOkRootSpans(projectId: string): Promise<SpanRow[]> {
    return this.sql<SpanRow[]>`
      SELECT DISTINCT ON (s.trace_id) s.*
      FROM spans s
      WHERE s.project_id = ${projectId} AND s.parent_span_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM spans e WHERE e.trace_id = s.trace_id AND e.status_code = 'ERROR')
      ORDER BY s.trace_id, s.start_time ASC
    `;
  }

  async getTraceStats(traceId: string): Promise<{ span_count: number; max_duration_ms: number; has_errors: boolean }> {
    const rows = await this.sql<Array<{ span_count: number; max_duration_ms: number; has_errors: boolean }>>`
      SELECT COUNT(*)::int AS span_count, MAX(duration_ms)::int AS max_duration_ms,
             BOOL_OR(status_code = 'ERROR') AS has_errors
      FROM spans WHERE trace_id = ${traceId}
    `;
    return rows[0] || { span_count: 0, max_duration_ms: 0, has_errors: false };
  }

  async getDistinctTraceIdsInWindow(projectId: string, minTime: number, maxTime: number, limit: number): Promise<string[]> {
    const rows = await this.sql<Array<{ trace_id: string }>>`
      SELECT DISTINCT trace_id FROM spans
      WHERE project_id = ${projectId} AND parent_span_id IS NULL
        AND start_time >= ${minTime} AND start_time <= ${maxTime}
      ORDER BY start_time DESC LIMIT ${limit}
    `;
    return rows.map(r => r.trace_id);
  }

  async getMatchingTraceIds(traceIds: string[], pathHints: string[]): Promise<string[]> {
    if (traceIds.length === 0 || pathHints.length === 0) return [];
    const rows = await this.sql<Array<{ trace_id: string }>>`
      SELECT DISTINCT trace_id FROM spans
      WHERE trace_id = ANY(${traceIds})
        AND (
          operation_name = ANY(${pathHints})
          OR attributes->>'http.target' = ANY(${pathHints})
          OR attributes->>'http.route' = ANY(${pathHints})
          OR attributes->>'url.path' = ANY(${pathHints})
        )
    `;
    return rows.map(r => r.trace_id);
  }

  // ─── Provider Status ───

  async upsertProviderStatus(provider: string, status: string, details: string | null): Promise<void> {
    await this.sql`
      INSERT INTO provider_status (provider, status, last_checked_at, details)
      VALUES (${provider}, ${status}, NOW(), ${details})
      ON CONFLICT (provider) DO UPDATE SET
        status = EXCLUDED.status, last_checked_at = EXCLUDED.last_checked_at, details = EXCLUDED.details
    `;
  }

  async getProviderStatuses(): Promise<ProviderStatusRow[]> {
    return this.sql<ProviderStatusRow[]>`SELECT provider, status, last_checked_at, details FROM provider_status ORDER BY provider`;
  }

  async hasRecentProviderEvent(provider: string): Promise<boolean> {
    const rows = await this.sql`
      SELECT id FROM events
      WHERE source = 'provider-status' AND raw_data->>'provider' = ${provider}
        AND created_at > NOW() - INTERVAL '10 minutes'
      LIMIT 1
    `;
    return rows.length > 0;
  }

  // ─── Notification Channels ───

  async getEnabledChannels(projectId: string): Promise<NotificationChannelRow[]> {
    return this.sql<NotificationChannelRow[]>`
      SELECT id, project_id, type, webhook_url, enabled, created_at
      FROM notification_channels WHERE project_id = ${projectId} AND enabled = true
    `;
  }

  async createChannel(projectId: string, type: string, webhookUrl: string): Promise<NotificationChannelRow> {
    const rows = await this.sql<NotificationChannelRow[]>`
      INSERT INTO notification_channels (project_id, type, webhook_url)
      VALUES (${projectId}, ${type}, ${webhookUrl})
      RETURNING id, project_id, type, webhook_url, enabled, created_at
    `;
    return rows[0];
  }

  async getChannels(projectId: string): Promise<NotificationChannelRow[]> {
    return this.sql<NotificationChannelRow[]>`
      SELECT id, project_id, type, webhook_url, enabled, created_at
      FROM notification_channels WHERE project_id = ${projectId} ORDER BY created_at DESC
    `;
  }

  async deleteChannel(id: string): Promise<void> {
    await this.sql`DELETE FROM notification_channels WHERE id = ${id}`;
  }

  async toggleChannel(id: string, enabled: boolean): Promise<void> {
    await this.sql`UPDATE notification_channels SET enabled = ${enabled} WHERE id = ${id}`;
  }

  async getChannelById(id: string): Promise<NotificationChannelRow | null> {
    const rows = await this.sql<NotificationChannelRow[]>`
      SELECT id, project_id, type, webhook_url, enabled, created_at
      FROM notification_channels WHERE id = ${id}
    `;
    return rows[0] || null;
  }

  // ─── Notification Log ───

  async hasNotificationForIncident(channelId: string, incidentId: string): Promise<boolean> {
    const rows = await this.sql`
      SELECT id FROM notification_log WHERE channel_id = ${channelId} AND incident_id = ${incidentId} LIMIT 1
    `;
    return rows.length > 0;
  }

  async getRecentNotificationCount(channelId: string): Promise<number> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const rows = await this.sql<Array<{ count: number }>>`
      SELECT COUNT(*) as count FROM notification_log WHERE channel_id = ${channelId} AND sent_at > ${oneHourAgo}
    `;
    return parseInt(String(rows[0]?.count || '0'));
  }

  async logNotification(channelId: string, incidentId: string): Promise<void> {
    await this.sql`INSERT INTO notification_log (channel_id, incident_id) VALUES (${channelId}, ${incidentId})`;
  }

  async getCorrelatedEvents(eventIds: string[]): Promise<Array<{ type: string; source: string; message: string; created_at: Date }>> {
    if (eventIds.length === 0) return [];
    return this.sql`
      SELECT type, source, message, created_at FROM events
      WHERE id = ANY(${eventIds}::uuid[]) ORDER BY created_at DESC LIMIT 10
    `;
  }

  // ─── Legacy Webhooks ───

  async insertWebhookEvent(event: string, service: string, data: unknown, timestamp: string): Promise<void> {
    await this.sql`
      INSERT INTO webhook_events (event, service, data, timestamp)
      VALUES (${event}, ${service}, ${JSON.stringify(data)}, ${timestamp})
    `;
  }

  // ─── Waitlist ───

  async addToWaitlist(email: string): Promise<void> {
    await this.sql`INSERT INTO waitlist (email) VALUES (${email.toLowerCase().trim()}) ON CONFLICT (email) DO NOTHING`;
  }

  async getWaitlist(): Promise<WaitlistRow[]> {
    return this.sql<WaitlistRow[]>`SELECT id, email, created_at FROM waitlist ORDER BY created_at DESC`;
  }
}
