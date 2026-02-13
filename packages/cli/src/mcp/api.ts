import axios, { type AxiosInstance } from 'axios';
import type { Event, Incident, Monitor } from '@scanwarp/core';

export interface ProviderStatus {
  provider: string;
  status: string;
  last_checked_at: Date;
  details: string | null;
}

export interface SpanRow {
  id: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  project_id: string;
  service_name: string;
  operation_name: string;
  kind: string;
  start_time: number;
  duration_ms: number;
  status_code: string | null;
  status_message: string | null;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; attributes?: Record<string, unknown> }>;
}

export interface TraceSummary {
  trace_id: string;
  root_span: SpanRow;
  span_count: number;
  max_duration_ms: number;
  has_errors: boolean;
}

export class ScanWarpAPI {
  private client: AxiosInstance;

  constructor(serverUrl: string, apiToken?: string) {
    this.client = axios.create({
      baseURL: serverUrl,
      headers: apiToken
        ? {
            Authorization: `Bearer ${apiToken}`,
          }
        : {},
    });
  }

  async getMonitors(projectId: string): Promise<Monitor[]> {
    const response = await this.client.get('/monitors', {
      params: { project_id: projectId },
    });
    return response.data.monitors || response.data;
  }

  async getIncidents(options: {
    projectId: string;
    status?: 'open' | 'resolved';
    severity?: 'critical' | 'warning' | 'info';
    limit?: number;
  }): Promise<Incident[]> {
    const response = await this.client.get('/incidents', {
      params: {
        project_id: options.projectId,
        status: options.status,
        severity: options.severity,
        limit: options.limit,
      },
    });
    return response.data.incidents || response.data;
  }

  async getIncident(incidentId: string): Promise<{
    incident: Incident;
    events: Event[];
  }> {
    const response = await this.client.get(`/incidents/${incidentId}`);
    return response.data;
  }

  async getEvents(options: {
    projectId: string;
    type?: string;
    source?: string;
    severity?: string;
    limit?: number;
  }): Promise<Event[]> {
    const response = await this.client.get('/events', {
      params: {
        project_id: options.projectId,
        type: options.type,
        source: options.source,
        severity: options.severity,
        limit: options.limit,
      },
    });
    return response.data;
  }

  async resolveIncident(incidentId: string): Promise<void> {
    await this.client.post(`/incidents/${incidentId}/resolve`);
  }

  async getProviderStatus(): Promise<ProviderStatus[]> {
    const response = await this.client.get('/provider-status');
    return response.data;
  }

  async getProject(name: string): Promise<{ id: string; name: string } | null> {
    const response = await this.client.get('/projects', {
      params: { name },
    });
    const projects = response.data;
    return projects.length > 0 ? projects[0] : null;
  }

  async getRecentTraces(options: {
    projectId: string;
    limit?: number;
    status?: 'error' | 'ok';
  }): Promise<TraceSummary[]> {
    const response = await this.client.get('/traces', {
      params: {
        project_id: options.projectId,
        limit: options.limit,
        status: options.status,
      },
    });
    return response.data.traces || [];
  }

  async getTraceDetail(traceId: string): Promise<SpanRow[]> {
    const response = await this.client.get(`/traces/${traceId}`);
    return response.data.spans || [];
  }

  async getIncidentTraces(incidentId: string): Promise<SpanRow[]> {
    const response = await this.client.get(`/incidents/${incidentId}/traces`);
    return response.data.spans || [];
  }
}
