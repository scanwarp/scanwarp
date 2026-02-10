export interface MonitoringConfig {
  id: string;
  serviceName: string;
  endpoint: string;
  interval: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MonitoringEvent {
  id: string;
  configId: string;
  status: 'success' | 'failure';
  responseTime?: number;
  statusCode?: number;
  errorMessage?: string;
  timestamp: Date;
}

export interface WebhookPayload {
  event: string;
  service: string;
  data: Record<string, unknown>;
  timestamp: string;
}
