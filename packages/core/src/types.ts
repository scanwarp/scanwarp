export interface Monitor {
  id: string;
  project_id: string;
  url: string;
  check_interval_seconds: number;
  last_checked_at?: Date;
  status: 'up' | 'down' | 'unknown';
  created_at: Date;
}

export type EventSource = 'monitor' | 'vercel' | 'stripe' | 'supabase' | 'github' | 'provider-status' | 'otel' | 'browser';

export interface Event {
  id: string;
  project_id: string;
  monitor_id?: string;
  type: 'error' | 'slow' | 'down' | 'up' | 'trace_error' | 'slow_query';
  source: EventSource;
  message: string;
  raw_data?: Record<string, unknown>;
  severity: 'low' | 'medium' | 'high' | 'critical';
  created_at: Date;
}

export interface EventStats {
  monitor_id: string;
  avg_response_time?: number;
  total_checks: number;
  error_count: number;
  last_error_at?: Date;
  updated_at: Date;
}

export interface VercelLogDrainPayload {
  source: string;
  deploymentId: string;
  message: string;
  timestamp: number;
  type: 'stdout' | 'stderr' | 'request' | 'response';
  level?: 'info' | 'warn' | 'error' | 'debug';
  [key: string]: unknown;
}

export interface WebhookPayload {
  event: string;
  service: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface Incident {
  id: string;
  project_id: string;
  events: string[]; // Array of event IDs
  correlation_group?: string;
  status: 'open' | 'investigating' | 'resolved';
  diagnosis_text?: string;
  diagnosis_fix?: string;
  severity: 'critical' | 'warning' | 'info';
  fix_prompt?: string;
  created_at: Date;
  resolved_at?: Date;
}

export interface DiagnosisResult {
  root_cause: string;
  severity: 'critical' | 'warning' | 'info';
  suggested_fix: string;
  fix_prompt: string;
  bottleneck_span?: string;
  trace_id?: string;
}

export interface TraceSpan {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
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

// Provider integrations
export interface ProviderStatus {
  provider: string;
  status: 'operational' | 'degraded' | 'outage';
  last_checked_at: Date;
  details?: string;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export interface GitHubWebhookEvent {
  action?: string;
  workflow_run?: {
    conclusion: string;
    name: string;
    html_url: string;
  };
  alert?: {
    number: number;
    state: string;
    html_url: string;
  };
  [key: string]: unknown;
}

export interface ProviderEvent {
  source: EventSource;
  type: Event['type'];
  message: string;
  severity: Event['severity'];
  raw_data: Record<string, unknown>;
}

// Legacy types (deprecated)
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
