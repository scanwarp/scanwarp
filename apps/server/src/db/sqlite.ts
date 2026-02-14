/**
 * SQLite implementation of the Database interface.
 * Uses better-sqlite3 for synchronous, fast SQLite access.
 *
 * Stores the database at ~/.scanwarp/scanwarp.db by default.
 * Auto-creates tables on first run and uses WAL mode.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type {
  Database as DatabaseInterface,
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

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  pages TEXT DEFAULT '[]',
  check_interval_seconds INTEGER NOT NULL DEFAULT 60,
  last_checked_at TEXT,
  status TEXT DEFAULT 'unknown',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_monitors_project_id ON monitors(project_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  monitor_id TEXT REFERENCES monitors(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'monitor',
  message TEXT NOT NULL,
  raw_data TEXT,
  severity TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_project_id ON events(project_id);
CREATE INDEX IF NOT EXISTS idx_events_monitor_id ON events(monitor_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

CREATE TABLE IF NOT EXISTS event_stats (
  monitor_id TEXT PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
  avg_response_time REAL,
  total_checks INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  last_error_at TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  events TEXT NOT NULL,
  correlation_group TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  diagnosis_text TEXT,
  diagnosis_fix TEXT,
  severity TEXT NOT NULL,
  fix_prompt TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_project_id ON incidents(project_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);

CREATE TABLE IF NOT EXISTS provider_status (
  provider TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_checked_at TEXT DEFAULT (datetime('now')),
  details TEXT
);

CREATE TABLE IF NOT EXISTS notification_channels (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notification_channels_project_id ON notification_channels(project_id);

CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY,
  channel_id TEXT REFERENCES notification_channels(id) ON DELETE CASCADE,
  incident_id TEXT REFERENCES incidents(id) ON DELETE CASCADE,
  sent_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notification_log_channel_id ON notification_log(channel_id);

CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS spans (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  project_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  operation_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  status_code TEXT,
  status_message TEXT,
  attributes TEXT DEFAULT '{}',
  events TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spans_project_id ON spans(project_id);
CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_start_time ON spans(start_time);

CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  service TEXT NOT NULL,
  data TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function parseDate(val: string | null | undefined): Date | null {
  if (!val) return null;
  return new Date(val.includes('T') ? val : val + 'Z');
}

function parseJson<T>(val: string | null | undefined): T | null {
  if (!val) return null;
  try { return JSON.parse(val) as T; } catch { return null; }
}

export class SqliteDatabase implements DatabaseInterface {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || this.defaultDbPath();

    // Ensure parent directory exists
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);

    // WAL mode for better concurrent read/write
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.initSchema();
    console.log(`SQLite database: ${resolvedPath}`);
  }

  private defaultDbPath(): string {
    // Use ~/.scanwarp/scanwarp.db for system installs
    return path.join(os.homedir(), '.scanwarp', 'scanwarp.db');
  }

  private initSchema() {
    // Check if _meta table exists
    const tableExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_meta'"
    ).get();

    if (!tableExists) {
      this.db.exec(SCHEMA_SQL);
      this.db.prepare("INSERT INTO _meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
      return;
    }

    const meta = this.db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'");
    const row = meta.get() as { value: string } | undefined;
    const currentVersion = row ? parseInt(row.value) : 0;

    if (currentVersion < SCHEMA_VERSION) {
      // Future migrations go here
      this.db.prepare("UPDATE _meta SET value = ? WHERE key = 'schema_version'").run(String(SCHEMA_VERSION));
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // ─── Row conversion helpers ───

  private toProjectRow(row: Record<string, unknown>): ProjectRow {
    return {
      id: row.id as string,
      name: row.name as string,
      created_at: parseDate(row.created_at as string) || new Date(),
    };
  }

  private toMonitorRow(row: Record<string, unknown>): MonitorRow {
    return {
      id: row.id as string,
      project_id: row.project_id as string,
      url: row.url as string,
      pages: row.pages as string || '[]',
      check_interval_seconds: row.check_interval_seconds as number,
      last_checked_at: parseDate(row.last_checked_at as string),
      status: row.status as string,
      created_at: parseDate(row.created_at as string) || new Date(),
    };
  }

  private toEventRow(row: Record<string, unknown>): EventRow {
    return {
      id: row.id as string,
      project_id: row.project_id as string,
      monitor_id: (row.monitor_id as string) || null,
      type: row.type as string,
      source: row.source as string,
      message: row.message as string,
      raw_data: parseJson<Record<string, unknown>>(row.raw_data as string),
      severity: row.severity as string,
      created_at: parseDate(row.created_at as string) || new Date(),
    };
  }

  private toIncidentRow(row: Record<string, unknown>): IncidentRow {
    return {
      id: row.id as string,
      project_id: row.project_id as string,
      events: parseJson<string[]>(row.events as string) || [],
      correlation_group: (row.correlation_group as string) || null,
      status: row.status as string,
      diagnosis_text: (row.diagnosis_text as string) || null,
      diagnosis_fix: (row.diagnosis_fix as string) || null,
      severity: row.severity as string,
      fix_prompt: (row.fix_prompt as string) || null,
      created_at: parseDate(row.created_at as string) || new Date(),
      resolved_at: parseDate(row.resolved_at as string),
    };
  }

  private toSpanRow(row: Record<string, unknown>): SpanRow {
    return {
      id: row.id as string,
      trace_id: row.trace_id as string,
      span_id: row.span_id as string,
      parent_span_id: (row.parent_span_id as string) || null,
      project_id: row.project_id as string,
      service_name: row.service_name as string,
      operation_name: row.operation_name as string,
      kind: row.kind as string,
      start_time: row.start_time as number,
      duration_ms: row.duration_ms as number,
      status_code: (row.status_code as string) || null,
      status_message: (row.status_message as string) || null,
      attributes: parseJson<Record<string, unknown>>(row.attributes as string) || {},
      events: parseJson<Array<{ name: string; attributes?: Record<string, unknown> }>>(row.events as string) || [],
      created_at: parseDate(row.created_at as string) || new Date(),
    };
  }

  private toChannelRow(row: Record<string, unknown>): NotificationChannelRow {
    return {
      id: row.id as string,
      project_id: row.project_id as string,
      type: row.type as string,
      webhook_url: row.webhook_url as string,
      enabled: row.enabled === 1 || row.enabled === true,
      created_at: parseDate(row.created_at as string) || new Date(),
    };
  }

  // ─── Projects ───

  async createProject(name: string): Promise<{ id: string }> {
    const id = uuid();
    this.db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(id, name);
    return { id };
  }

  async getProjects(name?: string): Promise<ProjectRow[]> {
    const rows = name
      ? this.db.prepare('SELECT * FROM projects WHERE name = ?').all(name) as Record<string, unknown>[]
      : this.db.prepare('SELECT * FROM projects').all() as Record<string, unknown>[];
    return rows.map(r => this.toProjectRow(r));
  }

  async getOrCreateProject(name: string): Promise<{ id: string }> {
    const existing = this.db.prepare('SELECT id FROM projects WHERE name = ?').get(name) as { id: string } | undefined;
    if (existing) return { id: existing.id };
    return this.createProject(name);
  }

  // ─── Monitors ───

  async createMonitor(projectId: string, url: string, checkIntervalSeconds: number): Promise<MonitorRow> {
    const id = uuid();
    const ts = now();
    this.db.prepare(
      'INSERT INTO monitors (id, project_id, url, check_interval_seconds, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, projectId, url, checkIntervalSeconds, ts);
    const row = this.db.prepare('SELECT * FROM monitors WHERE id = ?').get(id) as Record<string, unknown>;
    return this.toMonitorRow(row);
  }

  async getMonitors(): Promise<MonitorRow[]> {
    const rows = this.db.prepare('SELECT * FROM monitors ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(r => this.toMonitorRow(r));
  }

  async getMonitorById(id: string): Promise<MonitorRow | null> {
    const row = this.db.prepare('SELECT * FROM monitors WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.toMonitorRow(row) : null;
  }

  async updateMonitorStatus(id: string, status: string): Promise<void> {
    this.db.prepare('UPDATE monitors SET status = ?, last_checked_at = ? WHERE id = ?').run(status, now(), id);
  }

  // ─── Events ───

  async createEvent(params: {
    project_id: string; monitor_id?: string | null; type: string; source: string;
    message: string; raw_data?: Record<string, unknown> | null; severity: string;
  }): Promise<EventRow> {
    const id = uuid();
    const ts = now();
    this.db.prepare(
      'INSERT INTO events (id, project_id, monitor_id, type, source, message, raw_data, severity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, params.project_id, params.monitor_id || null, params.type, params.source, params.message,
      params.raw_data ? JSON.stringify(params.raw_data) : null, params.severity, ts);
    const row = this.db.prepare('SELECT * FROM events WHERE id = ?').get(id) as Record<string, unknown>;
    return this.toEventRow(row);
  }

  async getEvents(filters: EventFilters): Promise<EventRow[]> {
    const { monitor_id, project_id, type, source, limit = 100 } = filters;
    let sql = 'SELECT * FROM events WHERE 1=1';
    const params: unknown[] = [];
    if (monitor_id) { sql += ' AND monitor_id = ?'; params.push(monitor_id); }
    if (project_id) { sql += ' AND project_id = ?'; params.push(project_id); }
    if (type) { sql += ' AND type = ?'; params.push(type); }
    if (source) { sql += ' AND source = ?'; params.push(source); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.toEventRow(r));
  }

  async getEventsByIds(ids: string[]): Promise<EventRow[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM events WHERE id IN (${placeholders})`).all(...ids) as Record<string, unknown>[];
    return rows.map(r => this.toEventRow(r));
  }

  async flagEventForDiagnosis(eventId: string, reason: string): Promise<void> {
    const row = this.db.prepare('SELECT raw_data FROM events WHERE id = ?').get(eventId) as { raw_data: string | null } | undefined;
    const existing = parseJson<Record<string, unknown>>(row?.raw_data) || {};
    existing.flagged_for_diagnosis = true;
    existing.diagnosis_reason = reason;
    this.db.prepare('UPDATE events SET raw_data = ? WHERE id = ?').run(JSON.stringify(existing), eventId);
  }

  // ─── Event Statistics ───

  async getEventStats(monitorId: string): Promise<EventStatsRow | null> {
    const row = this.db.prepare('SELECT * FROM event_stats WHERE monitor_id = ?').get(monitorId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      monitor_id: row.monitor_id as string,
      avg_response_time: row.avg_response_time as number | null,
      total_checks: row.total_checks as number,
      error_count: row.error_count as number,
      last_error_at: parseDate(row.last_error_at as string),
      updated_at: parseDate(row.updated_at as string) || new Date(),
    };
  }

  async createEventStats(monitorId: string, avgResponseTime: number, isError: boolean): Promise<void> {
    this.db.prepare(
      'INSERT INTO event_stats (monitor_id, avg_response_time, total_checks, error_count, updated_at) VALUES (?, ?, 1, ?, ?)'
    ).run(monitorId, avgResponseTime, isError ? 1 : 0, now());
  }

  async updateEventStats(monitorId: string, newAvg: number, totalChecks: number, errorCount: number, isError: boolean): Promise<void> {
    if (isError) {
      this.db.prepare(
        'UPDATE event_stats SET avg_response_time = ?, total_checks = ?, error_count = ?, last_error_at = ?, updated_at = ? WHERE monitor_id = ?'
      ).run(newAvg, totalChecks, errorCount, now(), now(), monitorId);
    } else {
      this.db.prepare(
        'UPDATE event_stats SET avg_response_time = ?, total_checks = ?, error_count = ?, updated_at = ? WHERE monitor_id = ?'
      ).run(newAvg, totalChecks, errorCount, now(), monitorId);
    }
  }

  async getAvgResponseTime(monitorId: string): Promise<number | null> {
    const row = this.db.prepare('SELECT avg_response_time FROM event_stats WHERE monitor_id = ?').get(monitorId) as { avg_response_time: number | null } | undefined;
    return row?.avg_response_time ?? null;
  }

  // ─── Anomaly Detection ───

  async getSimilarErrorCount(monitorId: string, eventId: string, pattern: string): Promise<number> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM events
       WHERE monitor_id = ? AND type IN ('error', 'down')
         AND message LIKE ? AND id != ? AND created_at > ?`
    ).get(monitorId, `%${pattern}%`, eventId, cutoff) as { count: number };
    return row.count;
  }

  async getRecentErrorCount(monitorId: string): Promise<number> {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM events
       WHERE monitor_id = ? AND type IN ('error', 'down') AND created_at > ?`
    ).get(monitorId, cutoff) as { count: number };
    return row.count;
  }

  async getBaselineErrorRate(monitorId: string): Promise<number> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const row = this.db.prepare(
      `SELECT COUNT(*) as count, MIN(created_at) as min_created
       FROM events
       WHERE monitor_id = ? AND type IN ('error', 'down')
         AND created_at > ? AND created_at < ?`
    ).get(monitorId, sevenDaysAgo, oneHourAgo) as { count: number; min_created: string | null };
    if (!row.count || !row.min_created) return 0;
    const spanMs = Date.now() - new Date(row.min_created).getTime();
    if (spanMs <= 0) return 0;
    return (row.count / (spanMs / 1000)) * 3600;
  }

  // ─── Incidents ───

  async createIncident(projectId: string, eventIds: string[], severity: string): Promise<{ id: string }> {
    const id = uuid();
    this.db.prepare(
      "INSERT INTO incidents (id, project_id, events, status, severity, created_at) VALUES (?, ?, ?, 'open', ?, ?)"
    ).run(id, projectId, JSON.stringify(eventIds), severity, now());
    return { id };
  }

  async getIncident(id: string): Promise<IncidentRow | null> {
    const row = this.db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.toIncidentRow(row) : null;
  }

  async getIncidents(filters: IncidentFilters): Promise<IncidentRow[]> {
    const { project_id, status, limit = 50 } = filters;
    let sql = 'SELECT * FROM incidents WHERE 1=1';
    const params: unknown[] = [];
    if (project_id) { sql += ' AND project_id = ?'; params.push(project_id); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.toIncidentRow(r));
  }

  async updateIncidentDiagnosis(id: string, diagnosis: {
    root_cause: string; suggested_fix: string; fix_prompt: string; severity: string;
  }): Promise<void> {
    this.db.prepare(
      "UPDATE incidents SET diagnosis_text = ?, diagnosis_fix = ?, fix_prompt = ?, severity = ?, status = 'investigating' WHERE id = ?"
    ).run(diagnosis.root_cause, diagnosis.suggested_fix, diagnosis.fix_prompt, diagnosis.severity, id);
  }

  async resolveIncident(id: string): Promise<void> {
    this.db.prepare("UPDATE incidents SET status = 'resolved', resolved_at = ? WHERE id = ?").run(now(), id);
  }

  async getRecentEventHistory(monitorId: string): Promise<Array<{ created_at: Date; type: string; message: string }>> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rows = this.db.prepare(
      'SELECT created_at, type, message FROM events WHERE monitor_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 20'
    ).all(monitorId, cutoff) as Array<{ created_at: string; type: string; message: string }>;
    return rows.map(r => ({ ...r, created_at: parseDate(r.created_at) || new Date() }));
  }

  // ─── Spans ───

  async insertSpan(params: {
    trace_id: string; span_id: string; parent_span_id: string | null;
    project_id: string; service_name: string; operation_name: string; kind: string;
    start_time: number; duration_ms: number; status_code: string;
    status_message: string | null; attributes: Record<string, unknown>; events: unknown[];
  }): Promise<void> {
    const id = uuid();
    this.db.prepare(
      `INSERT INTO spans (id, trace_id, span_id, parent_span_id, project_id, service_name,
        operation_name, kind, start_time, duration_ms, status_code, status_message, attributes, events)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, params.trace_id, params.span_id, params.parent_span_id, params.project_id,
      params.service_name, params.operation_name, params.kind, params.start_time,
      params.duration_ms, params.status_code, params.status_message,
      JSON.stringify(params.attributes), JSON.stringify(params.events));
  }

  async getSpansByTraceId(traceId: string): Promise<SpanRow[]> {
    const rows = this.db.prepare('SELECT * FROM spans WHERE trace_id = ? ORDER BY start_time ASC').all(traceId) as Record<string, unknown>[];
    return rows.map(r => this.toSpanRow(r));
  }

  async getSpansByTraceIds(traceIds: string[], limit: number): Promise<SpanRow[]> {
    if (traceIds.length === 0) return [];
    const placeholders = traceIds.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT * FROM spans WHERE trace_id IN (${placeholders}) ORDER BY start_time ASC LIMIT ?`
    ).all(...traceIds, limit) as Record<string, unknown>[];
    return rows.map(r => this.toSpanRow(r));
  }

  async getRootSpans(projectId: string, limit: number): Promise<SpanRow[]> {
    const rows = this.db.prepare(
      'SELECT * FROM spans WHERE project_id = ? AND parent_span_id IS NULL ORDER BY start_time DESC LIMIT ?'
    ).all(projectId, limit) as Record<string, unknown>[];
    return rows.map(r => this.toSpanRow(r));
  }

  async getErrorRootSpans(projectId: string): Promise<SpanRow[]> {
    const rows = this.db.prepare(
      `SELECT s.* FROM spans s
       WHERE s.project_id = ? AND s.parent_span_id IS NULL
         AND EXISTS (SELECT 1 FROM spans e WHERE e.trace_id = s.trace_id AND e.status_code = 'ERROR')
       GROUP BY s.trace_id
       ORDER BY s.start_time ASC`
    ).all(projectId) as Record<string, unknown>[];
    return rows.map(r => this.toSpanRow(r));
  }

  async getOkRootSpans(projectId: string): Promise<SpanRow[]> {
    const rows = this.db.prepare(
      `SELECT s.* FROM spans s
       WHERE s.project_id = ? AND s.parent_span_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM spans e WHERE e.trace_id = s.trace_id AND e.status_code = 'ERROR')
       GROUP BY s.trace_id
       ORDER BY s.start_time ASC`
    ).all(projectId) as Record<string, unknown>[];
    return rows.map(r => this.toSpanRow(r));
  }

  async getTraceStats(traceId: string): Promise<{ span_count: number; max_duration_ms: number; has_errors: boolean }> {
    const row = this.db.prepare(
      `SELECT COUNT(*) as span_count, MAX(duration_ms) as max_duration_ms,
              MAX(CASE WHEN status_code = 'ERROR' THEN 1 ELSE 0 END) as has_errors
       FROM spans WHERE trace_id = ?`
    ).get(traceId) as { span_count: number; max_duration_ms: number; has_errors: number } | undefined;
    return {
      span_count: row?.span_count || 0,
      max_duration_ms: row?.max_duration_ms || 0,
      has_errors: (row?.has_errors || 0) === 1,
    };
  }

  async getDistinctTraceIdsInWindow(projectId: string, minTime: number, maxTime: number, limit: number): Promise<string[]> {
    const rows = this.db.prepare(
      `SELECT DISTINCT trace_id FROM spans
       WHERE project_id = ? AND parent_span_id IS NULL
         AND start_time >= ? AND start_time <= ?
       ORDER BY start_time DESC LIMIT ?`
    ).all(projectId, minTime, maxTime, limit) as Array<{ trace_id: string }>;
    return rows.map(r => r.trace_id);
  }

  async getMatchingTraceIds(traceIds: string[], pathHints: string[]): Promise<string[]> {
    if (traceIds.length === 0 || pathHints.length === 0) return [];
    const tPlaceholders = traceIds.map(() => '?').join(',');
    const pPlaceholders = pathHints.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT DISTINCT trace_id FROM spans
       WHERE trace_id IN (${tPlaceholders})
         AND (
           operation_name IN (${pPlaceholders})
           OR json_extract(attributes, '$."http.target"') IN (${pPlaceholders})
           OR json_extract(attributes, '$."http.route"') IN (${pPlaceholders})
           OR json_extract(attributes, '$."url.path"') IN (${pPlaceholders})
         )`
    ).all(...traceIds, ...pathHints, ...pathHints, ...pathHints, ...pathHints) as Array<{ trace_id: string }>;
    return rows.map(r => r.trace_id);
  }

  // ─── Provider Status ───

  async upsertProviderStatus(provider: string, status: string, details: string | null): Promise<void> {
    this.db.prepare(
      `INSERT INTO provider_status (provider, status, last_checked_at, details)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (provider) DO UPDATE SET status = excluded.status, last_checked_at = excluded.last_checked_at, details = excluded.details`
    ).run(provider, status, now(), details);
  }

  async getProviderStatuses(): Promise<ProviderStatusRow[]> {
    const rows = this.db.prepare('SELECT provider, status, last_checked_at, details FROM provider_status ORDER BY provider').all() as Record<string, unknown>[];
    return rows.map(r => ({
      provider: r.provider as string,
      status: r.status as string,
      last_checked_at: parseDate(r.last_checked_at as string),
      details: (r.details as string) || null,
    }));
  }

  async hasRecentProviderEvent(provider: string): Promise<boolean> {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const row = this.db.prepare(
      `SELECT id FROM events
       WHERE source = 'provider-status'
         AND json_extract(raw_data, '$.provider') = ?
         AND created_at > ?
       LIMIT 1`
    ).get(provider, cutoff);
    return !!row;
  }

  // ─── Notification Channels ───

  async getEnabledChannels(projectId: string): Promise<NotificationChannelRow[]> {
    const rows = this.db.prepare(
      'SELECT id, project_id, type, webhook_url, enabled, created_at FROM notification_channels WHERE project_id = ? AND enabled = 1'
    ).all(projectId) as Record<string, unknown>[];
    return rows.map(r => this.toChannelRow(r));
  }

  async createChannel(projectId: string, type: string, webhookUrl: string): Promise<NotificationChannelRow> {
    const id = uuid();
    this.db.prepare(
      'INSERT INTO notification_channels (id, project_id, type, webhook_url) VALUES (?, ?, ?, ?)'
    ).run(id, projectId, type, webhookUrl);
    const row = this.db.prepare('SELECT * FROM notification_channels WHERE id = ?').get(id) as Record<string, unknown>;
    return this.toChannelRow(row);
  }

  async getChannels(projectId: string): Promise<NotificationChannelRow[]> {
    const rows = this.db.prepare(
      'SELECT id, project_id, type, webhook_url, enabled, created_at FROM notification_channels WHERE project_id = ? ORDER BY created_at DESC'
    ).all(projectId) as Record<string, unknown>[];
    return rows.map(r => this.toChannelRow(r));
  }

  async deleteChannel(id: string): Promise<void> {
    this.db.prepare('DELETE FROM notification_channels WHERE id = ?').run(id);
  }

  async toggleChannel(id: string, enabled: boolean): Promise<void> {
    this.db.prepare('UPDATE notification_channels SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  }

  async getChannelById(id: string): Promise<NotificationChannelRow | null> {
    const row = this.db.prepare(
      'SELECT id, project_id, type, webhook_url, enabled, created_at FROM notification_channels WHERE id = ?'
    ).get(id) as Record<string, unknown> | undefined;
    return row ? this.toChannelRow(row) : null;
  }

  // ─── Notification Log ───

  async hasNotificationForIncident(channelId: string, incidentId: string): Promise<boolean> {
    const row = this.db.prepare(
      'SELECT id FROM notification_log WHERE channel_id = ? AND incident_id = ? LIMIT 1'
    ).get(channelId, incidentId);
    return !!row;
  }

  async getRecentNotificationCount(channelId: string): Promise<number> {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM notification_log WHERE channel_id = ? AND sent_at > ?'
    ).get(channelId, cutoff) as { count: number };
    return row.count;
  }

  async logNotification(channelId: string, incidentId: string): Promise<void> {
    this.db.prepare('INSERT INTO notification_log (id, channel_id, incident_id) VALUES (?, ?, ?)').run(uuid(), channelId, incidentId);
  }

  async getCorrelatedEvents(eventIds: string[]): Promise<Array<{ type: string; source: string; message: string; created_at: Date }>> {
    if (eventIds.length === 0) return [];
    const placeholders = eventIds.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT type, source, message, created_at FROM events WHERE id IN (${placeholders}) ORDER BY created_at DESC LIMIT 10`
    ).all(...eventIds) as Array<{ type: string; source: string; message: string; created_at: string }>;
    return rows.map(r => ({ ...r, created_at: parseDate(r.created_at) || new Date() }));
  }

  // ─── Legacy Webhooks ───

  async insertWebhookEvent(event: string, service: string, data: unknown, timestamp: string): Promise<void> {
    this.db.prepare(
      'INSERT INTO webhook_events (event, service, data, timestamp) VALUES (?, ?, ?, ?)'
    ).run(event, service, JSON.stringify(data), timestamp);
  }

  // ─── Waitlist ───

  async addToWaitlist(email: string): Promise<void> {
    this.db.prepare(
      'INSERT OR IGNORE INTO waitlist (id, email) VALUES (?, ?)'
    ).run(uuid(), email.toLowerCase().trim());
  }

  async getWaitlist(): Promise<WaitlistRow[]> {
    const rows = this.db.prepare('SELECT id, email, created_at FROM waitlist ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      email: r.email as string,
      created_at: parseDate(r.created_at as string) || new Date(),
    }));
  }
}
