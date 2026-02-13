/**
 * Real-time trace analyzers for scanwarp dev.
 *
 * Each analyzer inspects spans from a single trace and returns
 * zero or more analysis results (warnings, errors, suggestions).
 */

// ─── Shared types ───

export interface Span {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  service_name: string;
  operation_name: string;
  kind: string;
  start_time: number;
  duration_ms: number;
  status_code: string;
  status_message: string | null;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; attributes?: Record<string, unknown> }>;
}

export interface AnalysisResult {
  severity: 'error' | 'warning' | 'info';
  rule: string;
  message: string;
  detail?: string;
  suggestion?: string;
}

export interface Analyzer {
  name: string;
  analyze(spans: Span[]): AnalysisResult[];
}

// ─── Helpers ───

function getParentSpan(span: Span, spans: Span[]): Span | undefined {
  if (!span.parent_span_id) return undefined;
  return spans.find((s) => s.span_id === span.parent_span_id);
}

function isDbSpan(span: Span): boolean {
  return span.attributes['db.system'] !== undefined;
}

function isHttpClientSpan(span: Span): boolean {
  return (
    span.kind === 'CLIENT' &&
    (span.attributes['http.url'] !== undefined ||
      span.attributes['url.full'] !== undefined)
  );
}

function getHttpUrl(span: Span): string {
  const url = span.attributes['http.url'] || span.attributes['url.full'];
  return typeof url === 'string' ? url : String(url ?? '');
}

function getDbStatement(span: Span): string {
  const stmt = span.attributes['db.statement'];
  return typeof stmt === 'string' ? stmt : '';
}

/** Normalize a SQL statement by replacing literal values with ? placeholders */
function normalizeQuery(sql: string): string {
  return sql
    .replace(/'[^']*'/g, '?')      // string literals
    .replace(/\b\d+\b/g, '?')      // numeric literals
    .replace(/\s+/g, ' ')           // collapse whitespace
    .trim();
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max) + '...' : str;
}

function getErrorMessage(span: Span): string {
  // Try exception event first
  const exceptionEvent = span.events.find((e) => e.name === 'exception');
  const exceptionMsg = exceptionEvent?.attributes?.['exception.message'];
  if (typeof exceptionMsg === 'string') return exceptionMsg;

  // Fall back to status message
  if (span.status_message) return span.status_message;

  return 'Unknown error';
}

// ─── Analyzer implementations ───

/**
 * N+1 Query Detector
 *
 * Groups database spans by normalized query pattern within a single trace.
 * If the same pattern appears 5+ times, flags it as an N+1.
 */
export const nPlusOneDetector: Analyzer = {
  name: 'n-plus-one',
  analyze(spans) {
    const results: AnalysisResult[] = [];

    // Group DB spans by normalized statement
    const queryCounts = new Map<string, { count: number; raw: string }>();

    for (const span of spans) {
      if (!isDbSpan(span)) continue;
      const stmt = getDbStatement(span);
      if (!stmt) continue;

      const normalized = normalizeQuery(stmt);
      const existing = queryCounts.get(normalized);
      if (existing) {
        existing.count++;
      } else {
        queryCounts.set(normalized, { count: 1, raw: stmt });
      }
    }

    for (const [pattern, { count, raw }] of queryCounts) {
      if (count >= 5) {
        results.push({
          severity: 'warning',
          rule: 'n-plus-one',
          message: `N+1 query detected: '${truncate(pattern, 80)}' executed ${count} times`,
          detail: `Full query: ${truncate(raw, 200)}`,
          suggestion: 'Use a batch query or JOIN instead of querying in a loop',
        });
      }
    }

    return results;
  },
};

/**
 * Slow Database Query Detector
 *
 * Flags any database span over 500ms.
 */
export const slowQueryDetector: Analyzer = {
  name: 'slow-query',
  analyze(spans) {
    const results: AnalysisResult[] = [];

    for (const span of spans) {
      if (!isDbSpan(span)) continue;
      if (span.duration_ms <= 500) continue;

      const stmt = getDbStatement(span);
      const dbSystem = String(span.attributes['db.system'] || 'database');

      results.push({
        severity: 'warning',
        rule: 'slow-query',
        message: `Slow ${dbSystem} query: ${truncate(stmt || span.operation_name, 100)} (${span.duration_ms}ms)`,
        suggestion: 'Consider adding an index or optimizing this query',
      });
    }

    return results;
  },
};

/**
 * Unhandled Error Detector
 *
 * Detects when a span has ERROR status and its parent also has ERROR status,
 * indicating the error propagated up without being caught.
 */
export const unhandledErrorDetector: Analyzer = {
  name: 'unhandled-error',
  analyze(spans) {
    const results: AnalysisResult[] = [];

    for (const span of spans) {
      if (span.status_code !== 'ERROR') continue;

      const parent = getParentSpan(span, spans);
      if (!parent || parent.status_code !== 'ERROR') continue;

      // Skip HTTP client spans — they have their own analyzer
      if (isHttpClientSpan(span)) continue;

      const errorMsg = getErrorMessage(span);

      results.push({
        severity: 'error',
        rule: 'unhandled-error',
        message: `Unhandled error in ${span.operation_name}: ${truncate(errorMsg, 100)}`,
        suggestion: 'Add error handling (try/catch) around this operation',
      });
    }

    return results;
  },
};

/**
 * Missing Error Handling on External Calls
 *
 * When an HTTP client span fails and the parent span also has ERROR status,
 * the external call failure wasn't handled gracefully.
 */
export const missingErrorHandlingDetector: Analyzer = {
  name: 'missing-error-handling',
  analyze(spans) {
    const results: AnalysisResult[] = [];

    for (const span of spans) {
      if (!isHttpClientSpan(span)) continue;
      if (span.status_code !== 'ERROR') continue;

      const parent = getParentSpan(span, spans);
      if (!parent || parent.status_code !== 'ERROR') continue;

      const url = getHttpUrl(span);
      // Extract just the host for cleaner output
      let host = url;
      try {
        host = new URL(url).host;
      } catch {
        // keep raw url
      }

      results.push({
        severity: 'error',
        rule: 'missing-error-handling',
        message: `External API call to ${host} failed with no error handling`,
        detail: `URL: ${truncate(url, 150)}`,
        suggestion: 'Wrap this API call in try/catch and handle failures gracefully',
      });
    }

    return results;
  },
};

/**
 * Slow External API Call
 *
 * Flags any HTTP client span over 2 seconds.
 */
export const slowExternalCallDetector: Analyzer = {
  name: 'slow-external-call',
  analyze(spans) {
    const results: AnalysisResult[] = [];

    for (const span of spans) {
      if (!isHttpClientSpan(span)) continue;
      if (span.duration_ms <= 2000) continue;

      const url = getHttpUrl(span);
      let host = url;
      try {
        host = new URL(url).host;
      } catch {
        // keep raw url
      }

      results.push({
        severity: 'warning',
        rule: 'slow-external-call',
        message: `Slow external call to ${host}: ${span.duration_ms}ms`,
        detail: `URL: ${truncate(url, 150)}`,
        suggestion: 'Consider adding a timeout, caching the response, or making it async',
      });
    }

    return results;
  },
};

// ─── All built-in analyzers ───

export const defaultAnalyzers: Analyzer[] = [
  nPlusOneDetector,
  slowQueryDetector,
  unhandledErrorDetector,
  missingErrorHandlingDetector,
  slowExternalCallDetector,
];
