async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// Types
export interface Monitor {
  id: string;
  project_id: string;
  url: string;
  pages?: string[];
  check_interval_seconds: number;
  last_checked_at: string | null;
  status: 'up' | 'down' | 'unknown';
  created_at: string;
}

export interface Event {
  id: string;
  project_id: string;
  monitor_id: string | null;
  type: string;
  source: string;
  message: string;
  raw_data: Record<string, unknown> | null;
  severity: string;
  created_at: string;
}

export interface Incident {
  id: string;
  project_id: string;
  events: string[];
  status: string;
  severity: string;
  diagnosis_text: string | null;
  diagnosis_fix: string | null;
  fix_prompt: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface Span {
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

export interface TraceItem {
  trace_id: string;
  root_span: Span;
  span_count: number;
  max_duration_ms: number;
  has_errors: boolean;
}

// API methods
export const api = {
  getMonitors: () => get<{ monitors: Monitor[] }>('/monitors'),
  getMonitor: (id: string) => get<{ monitor: Monitor }>(`/monitors/${id}`),
  getEvents: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return get<{ events: Event[] }>(`/events${qs}`);
  },
  getIncidents: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return get<{ incidents: Incident[] }>(`/incidents${qs}`);
  },
  getIncident: (id: string) => get<{ incident: Incident; events: Event[] }>(`/incidents/${id}`),
  resolveIncident: (id: string) => post<{ success: boolean }>(`/incidents/${id}/resolve`),
  getTraces: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return get<{ traces: TraceItem[] }>(`/traces${qs}`);
  },
  getTrace: (traceId: string) => get<{ trace_id: string; spans: Span[] }>(`/traces/${traceId}`),
  getIncidentTraces: (id: string) => get<{ incident_id: string; spans: Span[] }>(`/incidents/${id}/traces`),
  getHealth: () => get<{ status: string; timestamp: string }>('/health'),
};
