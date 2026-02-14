/**
 * Database abstraction layer.
 *
 * Provides a unified interface over PostgreSQL and SQLite so the server
 * can run without Docker/Postgres for solo devs and small teams.
 *
 * Selection: set DATABASE_TYPE=sqlite or DATABASE_TYPE=postgres.
 * Default: postgres if POSTGRES_HOST is set, sqlite otherwise.
 */

import { PostgresDatabase } from './postgres.js';
import { SqliteDatabase } from './sqlite.js';

// ─── Row types returned by the database ───

export interface ProjectRow {
  id: string;
  name: string;
  created_at: Date;
}

export interface MonitorRow {
  id: string;
  project_id: string;
  url: string;
  pages: string;
  check_interval_seconds: number;
  last_checked_at: Date | null;
  status: string;
  created_at: Date;
}

export interface EventRow {
  id: string;
  project_id: string;
  monitor_id: string | null;
  type: string;
  source: string;
  message: string;
  raw_data: Record<string, unknown> | null;
  severity: string;
  created_at: Date;
}

export interface EventStatsRow {
  monitor_id: string;
  avg_response_time: number | null;
  total_checks: number;
  error_count: number;
  last_error_at: Date | null;
  updated_at: Date;
}

export interface IncidentRow {
  id: string;
  project_id: string;
  events: string[];
  correlation_group: string | null;
  status: string;
  diagnosis_text: string | null;
  diagnosis_fix: string | null;
  severity: string;
  fix_prompt: string | null;
  created_at: Date;
  resolved_at: Date | null;
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
  created_at: Date;
}

export interface ProviderStatusRow {
  provider: string;
  status: string;
  last_checked_at: Date | null;
  details: string | null;
}

export interface NotificationChannelRow {
  id: string;
  project_id: string;
  type: string;
  webhook_url: string;
  enabled: boolean;
  created_at: Date;
}

export interface WaitlistRow {
  id: string;
  email: string;
  created_at: Date;
}

export interface EventFilters {
  monitor_id?: string;
  project_id?: string;
  type?: string;
  source?: string;
  limit?: number;
}

export interface IncidentFilters {
  project_id?: string;
  status?: string;
  limit?: number;
}

// ─── Database interface ───

export interface Database {
  // Connection
  close(): Promise<void>;

  // Projects
  createProject(name: string): Promise<{ id: string }>;
  getProjects(name?: string): Promise<ProjectRow[]>;
  getOrCreateProject(name: string): Promise<{ id: string }>;

  // Monitors
  createMonitor(projectId: string, url: string, checkIntervalSeconds: number): Promise<MonitorRow>;
  getMonitors(): Promise<MonitorRow[]>;
  getMonitorById(id: string): Promise<MonitorRow | null>;
  updateMonitorStatus(id: string, status: string): Promise<void>;

  // Events
  createEvent(params: {
    project_id: string;
    monitor_id?: string | null;
    type: string;
    source: string;
    message: string;
    raw_data?: Record<string, unknown> | null;
    severity: string;
  }): Promise<EventRow>;
  getEvents(filters: EventFilters): Promise<EventRow[]>;
  getEventsByIds(ids: string[]): Promise<EventRow[]>;
  flagEventForDiagnosis(eventId: string, reason: string): Promise<void>;

  // Event Statistics
  getEventStats(monitorId: string): Promise<EventStatsRow | null>;
  createEventStats(monitorId: string, avgResponseTime: number, isError: boolean): Promise<void>;
  updateEventStats(monitorId: string, newAvg: number, totalChecks: number, errorCount: number, isError: boolean): Promise<void>;
  getAvgResponseTime(monitorId: string): Promise<number | null>;

  // Anomaly Detection
  getSimilarErrorCount(monitorId: string, eventId: string, pattern: string): Promise<number>;
  getRecentErrorCount(monitorId: string): Promise<number>;
  getBaselineErrorRate(monitorId: string): Promise<number>;

  // Incidents
  createIncident(projectId: string, eventIds: string[], severity: string): Promise<{ id: string }>;
  getIncident(id: string): Promise<IncidentRow | null>;
  getIncidents(filters: IncidentFilters): Promise<IncidentRow[]>;
  updateIncidentDiagnosis(id: string, diagnosis: {
    root_cause: string;
    suggested_fix: string;
    fix_prompt: string;
    severity: string;
  }): Promise<void>;
  resolveIncident(id: string): Promise<void>;

  // Incident → Event History
  getRecentEventHistory(monitorId: string): Promise<Array<{ created_at: Date; type: string; message: string }>>;

  // Spans (OpenTelemetry)
  insertSpan(params: {
    trace_id: string;
    span_id: string;
    parent_span_id: string | null;
    project_id: string;
    service_name: string;
    operation_name: string;
    kind: string;
    start_time: number;
    duration_ms: number;
    status_code: string;
    status_message: string | null;
    attributes: Record<string, unknown>;
    events: unknown[];
  }): Promise<void>;
  getSpansByTraceId(traceId: string): Promise<SpanRow[]>;
  getSpansByTraceIds(traceIds: string[], limit: number): Promise<SpanRow[]>;
  getRootSpans(projectId: string, limit: number): Promise<SpanRow[]>;
  getErrorRootSpans(projectId: string): Promise<SpanRow[]>;
  getOkRootSpans(projectId: string): Promise<SpanRow[]>;
  getTraceStats(traceId: string): Promise<{ span_count: number; max_duration_ms: number; has_errors: boolean }>;
  getDistinctTraceIdsInWindow(projectId: string, minTime: number, maxTime: number, limit: number): Promise<string[]>;
  getMatchingTraceIds(traceIds: string[], pathHints: string[]): Promise<string[]>;

  // Provider Status
  upsertProviderStatus(provider: string, status: string, details: string | null): Promise<void>;
  getProviderStatuses(): Promise<ProviderStatusRow[]>;
  hasRecentProviderEvent(provider: string): Promise<boolean>;

  // Notification Channels
  getEnabledChannels(projectId: string): Promise<NotificationChannelRow[]>;
  createChannel(projectId: string, type: string, webhookUrl: string): Promise<NotificationChannelRow>;
  getChannels(projectId: string): Promise<NotificationChannelRow[]>;
  deleteChannel(id: string): Promise<void>;
  toggleChannel(id: string, enabled: boolean): Promise<void>;
  getChannelById(id: string): Promise<NotificationChannelRow | null>;

  // Notification Log
  hasNotificationForIncident(channelId: string, incidentId: string): Promise<boolean>;
  getRecentNotificationCount(channelId: string): Promise<number>;
  logNotification(channelId: string, incidentId: string): Promise<void>;

  // Correlated Events (for notifications)
  getCorrelatedEvents(eventIds: string[]): Promise<Array<{ type: string; source: string; message: string; created_at: Date }>>;

  // Legacy Webhooks
  insertWebhookEvent(event: string, service: string, data: unknown, timestamp: string): Promise<void>;

  // Waitlist
  addToWaitlist(email: string): Promise<void>;
  getWaitlist(): Promise<WaitlistRow[]>;
}

// ─── Factory ───

export function createDatabase(): Database {
  const dbType = process.env.DATABASE_TYPE
    || (process.env.POSTGRES_HOST ? 'postgres' : 'sqlite');

  if (dbType === 'sqlite') {
    const dbPath = process.env.SQLITE_PATH || undefined;
    return new SqliteDatabase(dbPath);
  }

  return new PostgresDatabase({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'scanwarp',
    username: process.env.POSTGRES_USER || 'scanwarp',
    password: process.env.POSTGRES_PASSWORD || 'scanwarp',
  });
}
