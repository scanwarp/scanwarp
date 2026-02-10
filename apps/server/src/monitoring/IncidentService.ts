import type postgres from 'postgres';
import { Diagnoser, type Event, type Monitor, type Incident } from '@scanwarp/core';
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

    // Call the diagnoser
    const diagnosis = await this.diagnoser!.diagnose({
      events: eventObjects,
      monitor,
      recentHistory: recentHistory.map((h) => ({
        timestamp: h.created_at,
        status: h.type,
        message: h.message,
      })),
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
