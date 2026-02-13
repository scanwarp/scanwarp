import type postgres from 'postgres';
import { Diagnoser, type Event, type Monitor, type Incident, type TraceSpan } from '@scanwarp/core';
import { NotificationManager } from '../notifications/manager.js';

export class IncidentService {
  private sql: postgres.Sql;
  private diagnoser: Diagnoser | null = null;
  private notificationManager: NotificationManager;

  constructor(sql: postgres.Sql, apiKey?: string) {
    this.sql = sql;
    this.notificationManager = new NotificationManager(sql);

    if (apiKey) {
      this.diagnoser = new Diagnoser({ apiKey });
      console.log('AI diagnosis enabled');
    } else {
      console.warn('ANTHROPIC_API_KEY not set - AI diagnosis will be disabled');
    }
  }

  async createIncident(eventIds: string[]): Promise<string> {
    if (eventIds.length === 0) {
      throw new Error('Cannot create incident without events');
    }

    // Fetch the events
    const events = await this.sql<Array<{
      id: string;
      project_id: string;
      monitor_id: string | null;
      type: string;
      source: string;
      message: string;
      raw_data: Record<string, unknown> | null;
      severity: string;
      created_at: Date;
    }>>`
      SELECT * FROM events WHERE id = ANY(${eventIds})
    `;

    if (events.length === 0) {
      throw new Error('No events found for the given IDs');
    }

    const projectId = events[0].project_id;
    const monitorId = events[0].monitor_id;

    // Determine initial severity based on events
    const severity = this.calculateSeverity(events);

    // Create the incident first (without diagnosis)
    const incident = await this.sql<Array<{
      id: string;
    }>>`
      INSERT INTO incidents (
        project_id, events, status, severity, created_at
      ) VALUES (
        ${projectId},
        ${JSON.stringify(eventIds)},
        'open',
        ${severity},
        NOW()
      )
      RETURNING id
    `;

    const incidentId = incident[0].id;
    console.log(`Created incident ${incidentId} for ${events.length} event(s)`);

    // Run AI diagnosis if available
    if (this.diagnoser) {
      try {
        await this.runDiagnosis(incidentId, events, monitorId);
      } catch (error) {
        console.error('Failed to run diagnosis:', error);
        // Don't fail the incident creation if diagnosis fails
      }
    }

    return incidentId;
  }

  private async runDiagnosis(
    incidentId: string,
    events: Array<{
      id: string;
      project_id: string;
      monitor_id: string | null;
      type: string;
      source: string;
      message: string;
      raw_data: Record<string, unknown> | null;
      severity: string;
      created_at: Date;
    }>,
    monitorId: string | null
  ) {
    console.log(`Running AI diagnosis for incident ${incidentId}...`);

    // Convert database rows to Event type
    const eventObjects: Event[] = events.map((e) => ({
      id: e.id,
      project_id: e.project_id,
      monitor_id: e.monitor_id || undefined,
      type: e.type as Event['type'],
      source: e.source as Event['source'],
      message: e.message,
      raw_data: e.raw_data || undefined,
      severity: e.severity as Event['severity'],
      created_at: e.created_at,
    }));

    // Fetch monitor info if available
    let monitor: Monitor | undefined;
    if (monitorId) {
      const monitors = await this.sql<Array<{
        id: string;
        project_id: string;
        url: string;
        check_interval_seconds: number;
        last_checked_at: Date | null;
        status: string;
        created_at: Date;
      }>>`
        SELECT * FROM monitors WHERE id = ${monitorId}
      `;

      if (monitors.length > 0) {
        const m = monitors[0];
        monitor = {
          id: m.id,
          project_id: m.project_id,
          url: m.url,
          check_interval_seconds: m.check_interval_seconds,
          last_checked_at: m.last_checked_at || undefined,
          status: m.status as Monitor['status'],
          created_at: m.created_at,
        };
      }
    }

    // Fetch recent history
    const recentHistory = monitorId
      ? await this.sql<Array<{
          created_at: Date;
          type: string;
          message: string;
        }>>`
          SELECT created_at, type, message
          FROM events
          WHERE monitor_id = ${monitorId}
            AND created_at > NOW() - INTERVAL '24 hours'
          ORDER BY created_at DESC
          LIMIT 20
        `
      : [];

    // Fetch related traces from the spans table
    const traces = await this.fetchRelatedTraces(events);

    // Call the diagnoser
    const diagnosis = await this.diagnoser!.diagnose({
      events: eventObjects,
      monitor,
      recentHistory: recentHistory.map((h) => ({
        timestamp: h.created_at,
        status: h.type,
        message: h.message,
      })),
      traces,
    });

    // Update the incident with diagnosis
    await this.sql`
      UPDATE incidents
      SET
        diagnosis_text = ${diagnosis.root_cause},
        diagnosis_fix = ${diagnosis.suggested_fix},
        fix_prompt = ${diagnosis.fix_prompt},
        severity = ${diagnosis.severity},
        status = 'investigating'
      WHERE id = ${incidentId}
    `;

    console.log(`Diagnosis completed for incident ${incidentId}`);

    // Fetch the updated incident and send notifications
    const updatedIncident = await this.getIncident(incidentId);
    if (updatedIncident) {
      try {
        await this.notificationManager.notify(updatedIncident);
      } catch (error) {
        console.error('Failed to send notifications:', error);
        // Don't fail the diagnosis if notifications fail
      }
    }
  }

  private async fetchRelatedTraces(
    events: Array<{
      project_id: string;
      raw_data: Record<string, unknown> | null;
      created_at: Date;
    }>
  ): Promise<TraceSpan[]> {
    if (events.length === 0) return [];

    const projectId = events[0].project_id;

    // Determine time window: earliest event - 2 min to latest event + 2 min
    const timestamps = events.map((e) => e.created_at.getTime());
    const minTime = Math.min(...timestamps) - 2 * 60 * 1000;
    const maxTime = Math.max(...timestamps) + 2 * 60 * 1000;

    // Check if any event has a direct trace_id reference (from otel events)
    const traceIds: string[] = [];
    for (const event of events) {
      const traceId = event.raw_data?.['trace_id'];
      if (typeof traceId === 'string') {
        traceIds.push(traceId);
      }
    }

    // Extract HTTP path hints from events for filtering
    const pathHints: string[] = [];
    for (const event of events) {
      const rd = event.raw_data;
      if (!rd) continue;
      // Extract path from various event formats
      const path = rd['http.target'] || rd['http.route'] || rd['url'];
      if (typeof path === 'string' && path.startsWith('/')) {
        pathHints.push(path);
      }
      // Also check operation_name for otel events
      const opName = rd['operation_name'];
      if (typeof opName === 'string') {
        pathHints.push(opName);
      }
    }

    let spans: Array<{
      trace_id: string;
      span_id: string;
      parent_span_id: string | null;
      service_name: string;
      operation_name: string;
      kind: string;
      start_time: string;
      duration_ms: number;
      status_code: string | null;
      status_message: string | null;
      attributes: Record<string, unknown>;
      events: Array<{ name: string; attributes?: Record<string, unknown> }>;
    }>;

    if (traceIds.length > 0) {
      // Direct trace lookup — fetch all spans for these trace IDs
      spans = await this.sql`
        SELECT trace_id, span_id, parent_span_id, service_name, operation_name,
               kind, start_time, duration_ms, status_code, status_message,
               attributes, events
        FROM spans
        WHERE trace_id = ANY(${traceIds})
        ORDER BY start_time ASC
        LIMIT 200
      `;
    } else {
      // Time-window lookup — find root spans in the project near the incident
      const rootSpans = await this.sql<Array<{ trace_id: string }>>`
        SELECT DISTINCT trace_id
        FROM spans
        WHERE project_id = ${projectId}
          AND parent_span_id IS NULL
          AND start_time >= ${minTime}
          AND start_time <= ${maxTime}
        ORDER BY start_time DESC
        LIMIT 10
      `;

      if (rootSpans.length === 0) return [];

      const rootTraceIds = rootSpans.map((r) => r.trace_id);

      // If we have path hints, prefer traces that match them
      if (pathHints.length > 0) {
        const matchingTraces = await this.sql<Array<{ trace_id: string }>>`
          SELECT DISTINCT trace_id
          FROM spans
          WHERE trace_id = ANY(${rootTraceIds})
            AND (
              operation_name = ANY(${pathHints})
              OR attributes->>'http.target' = ANY(${pathHints})
              OR attributes->>'http.route' = ANY(${pathHints})
              OR attributes->>'url.path' = ANY(${pathHints})
            )
        `;

        if (matchingTraces.length > 0) {
          const filteredIds = matchingTraces.map((t) => t.trace_id);
          spans = await this.sql`
            SELECT trace_id, span_id, parent_span_id, service_name, operation_name,
                   kind, start_time, duration_ms, status_code, status_message,
                   attributes, events
            FROM spans
            WHERE trace_id = ANY(${filteredIds})
            ORDER BY start_time ASC
            LIMIT 200
          `;
        } else {
          // No path match — use all root traces from the time window
          spans = await this.sql`
            SELECT trace_id, span_id, parent_span_id, service_name, operation_name,
                   kind, start_time, duration_ms, status_code, status_message,
                   attributes, events
            FROM spans
            WHERE trace_id = ANY(${rootTraceIds})
            ORDER BY start_time ASC
            LIMIT 200
          `;
        }
      } else {
        spans = await this.sql`
          SELECT trace_id, span_id, parent_span_id, service_name, operation_name,
                 kind, start_time, duration_ms, status_code, status_message,
                 attributes, events
          FROM spans
          WHERE trace_id = ANY(${rootTraceIds})
          ORDER BY start_time ASC
          LIMIT 200
        `;
      }
    }

    // Convert to TraceSpan type
    return spans.map((s) => ({
      trace_id: s.trace_id,
      span_id: s.span_id,
      parent_span_id: s.parent_span_id,
      service_name: s.service_name,
      operation_name: s.operation_name,
      kind: s.kind,
      start_time: Number(s.start_time),
      duration_ms: s.duration_ms,
      status_code: s.status_code,
      status_message: s.status_message,
      attributes: s.attributes || {},
      events: Array.isArray(s.events) ? s.events : [],
    }));
  }

  private calculateSeverity(
    events: Array<{ severity: string }>
  ): 'critical' | 'warning' | 'info' {
    // Find the highest severity among events
    const hasCritical = events.some((e) => e.severity === 'critical');
    const hasHigh = events.some((e) => e.severity === 'high');

    if (hasCritical || hasHigh) return 'critical';
    if (events.some((e) => e.severity === 'medium')) return 'warning';
    return 'info';
  }

  async resolveIncident(incidentId: string): Promise<void> {
    await this.sql`
      UPDATE incidents
      SET status = 'resolved', resolved_at = NOW()
      WHERE id = ${incidentId}
    `;

    console.log(`Incident ${incidentId} resolved`);

    // Send resolution notifications
    const incident = await this.getIncident(incidentId);
    if (incident) {
      try {
        await this.notificationManager.notifyResolution(incident);
      } catch (error) {
        console.error('Failed to send resolution notifications:', error);
      }
    }
  }

  async getIncident(incidentId: string): Promise<Incident | null> {
    const results = await this.sql<Array<{
      id: string;
      project_id: string;
      events: string[];
      status: string;
      diagnosis_text: string | null;
      diagnosis_fix: string | null;
      severity: string;
      fix_prompt: string | null;
      created_at: Date;
      resolved_at: Date | null;
    }>>`
      SELECT * FROM incidents WHERE id = ${incidentId}
    `;

    if (results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id,
      project_id: row.project_id,
      events: row.events,
      status: row.status as Incident['status'],
      diagnosis_text: row.diagnosis_text || undefined,
      diagnosis_fix: row.diagnosis_fix || undefined,
      severity: row.severity as Incident['severity'],
      fix_prompt: row.fix_prompt || undefined,
      created_at: row.created_at,
      resolved_at: row.resolved_at || undefined,
    };
  }
}
