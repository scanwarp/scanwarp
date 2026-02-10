import axios, { type AxiosInstance } from 'axios';
import type { Event, Incident, Monitor } from '@scanwarp/core';

export interface ProviderStatus {
  provider: string;
  status: string;
  last_checked_at: Date;
  details: string | null;
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
}
