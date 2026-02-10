import axios, { type AxiosInstance } from 'axios';

export class ScanWarpAPI {
  public client: AxiosInstance;
  public serverUrl: string;

  constructor(serverUrl: string = 'http://localhost:3000') {
    this.serverUrl = serverUrl;
    this.client = axios.create({
      baseURL: serverUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async createProject(name: string): Promise<{ id: string }> {
    try {
      // Check if project exists
      const { data: existing } = await this.client.get('/projects', {
        params: { name },
      });

      if (existing && existing.length > 0) {
        return { id: existing[0].id };
      }
    } catch {
      // Project doesn't exist, will create
    }

    const { data } = await this.client.post('/projects', { name });
    return data;
  }

  async createMonitor(projectId: string, url: string): Promise<{ id: string }> {
    const { data } = await this.client.post('/monitors', {
      project_id: projectId,
      url,
      check_interval_seconds: 60,
    });

    return data.monitor;
  }

  async testConnection(): Promise<boolean> {
    try {
      const { data } = await this.client.get('/health');
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  async getWebhookUrl(path: string): Promise<string> {
    return `${this.serverUrl}${path}`;
  }
}
