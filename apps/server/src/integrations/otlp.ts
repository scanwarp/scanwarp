import type { FastifyInstance } from 'fastify';
import type postgres from 'postgres';
import type { AnomalyDetector } from '../monitoring/AnomalyDetector.js';
import type { IncidentService } from '../monitoring/IncidentService.js';

// OTLP JSON span format (subset of fields we care about)
interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: OtlpAttribute[];
  status?: { code?: number; message?: string };
  events?: OtlpSpanEvent[];
}

interface OtlpAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string;
    doubleValue?: number;
    boolValue?: boolean;
  };
}

interface OtlpSpanEvent {
  name: string;
  timeUnixNano: string;
  attributes?: OtlpAttribute[];
}

interface OtlpResource {
  attributes?: OtlpAttribute[];
}

interface OtlpScopeSpans {
  spans: OtlpSpan[];
}

interface OtlpResourceSpans {
  resource?: OtlpResource;
  scopeSpans?: OtlpScopeSpans[];
}

interface OtlpTracePayload {
  resourceSpans?: OtlpResourceSpans[];
}

interface OtlpMetricPayload {
  resourceMetrics?: unknown[];
}

// Map OTLP span kind enum to string
const SPAN_KIND_MAP: Record<number, string> = {
  0: 'UNSPECIFIED',
  1: 'INTERNAL',
  2: 'SERVER',
  3: 'CLIENT',
  4: 'PRODUCER',
  5: 'CONSUMER',
};

// Map OTLP status code enum to string
const STATUS_CODE_MAP: Record<number, string> = {
  0: 'UNSET',
  1: 'OK',
  2: 'ERROR',
};

export async function registerOtlpRoutes(
  fastify: FastifyInstance,
  sql: postgres.Sql,
  anomalyDetector: AnomalyDetector,
  incidentService: IncidentService,
) {
  // POST /v1/traces — OTLP JSON trace ingest
  fastify.post<{ Body: OtlpTracePayload }>('/v1/traces', async (request, reply) => {
    const projectId = request.headers['x-scanwarp-project-id'] as string | undefined;

    if (!projectId) {
      reply.code(400);
      return { error: 'Missing x-scanwarp-project-id header' };
    }

    const payload = request.body;

    if (!payload.resourceSpans || payload.resourceSpans.length === 0) {
      return { partialSuccess: {} };
    }

    try {
      let spanCount = 0;

      for (const resourceSpan of payload.resourceSpans) {
        const serviceName = extractServiceName(resourceSpan.resource) || 'unknown-service';

        for (const scopeSpan of resourceSpan.scopeSpans || []) {
          for (const otlpSpan of scopeSpan.spans) {
            const startTimeNano = BigInt(otlpSpan.startTimeUnixNano);
            const endTimeNano = BigInt(otlpSpan.endTimeUnixNano);
            const startTimeMs = Number(startTimeNano / BigInt(1_000_000));
            const durationMs = Number((endTimeNano - startTimeNano) / BigInt(1_000_000));
            const statusCode = STATUS_CODE_MAP[otlpSpan.status?.code ?? 0] || 'UNSET';
            const statusMessage = otlpSpan.status?.message || null;
            const attributes = flattenAttributes(otlpSpan.attributes);
            const spanEvents = (otlpSpan.events || []).map(e => ({
              name: e.name,
              timeUnixNano: e.timeUnixNano,
              attributes: flattenAttributes(e.attributes),
            }));

            await sql`
              INSERT INTO spans (
                trace_id, span_id, parent_span_id, project_id, service_name,
                operation_name, kind, start_time, duration_ms,
                status_code, status_message, attributes, events
              ) VALUES (
                ${otlpSpan.traceId},
                ${otlpSpan.spanId},
                ${otlpSpan.parentSpanId || null},
                ${projectId},
                ${serviceName},
                ${otlpSpan.name},
                ${SPAN_KIND_MAP[otlpSpan.kind] || 'UNSPECIFIED'},
                ${startTimeMs},
                ${durationMs},
                ${statusCode},
                ${statusMessage},
                ${JSON.stringify(attributes)},
                ${JSON.stringify(spanEvents)}
              )
            `;

            spanCount++;

            // Check for error spans → create trace_error events
            if (statusCode === 'ERROR') {
              await createTraceEvent(
                sql,
                anomalyDetector,
                incidentService,
                projectId,
                'trace_error',
                'high',
                `Trace error in ${serviceName}: ${otlpSpan.name}${statusMessage ? ` — ${statusMessage}` : ''}`,
                {
                  trace_id: otlpSpan.traceId,
                  span_id: otlpSpan.spanId,
                  service_name: serviceName,
                  operation_name: otlpSpan.name,
                  duration_ms: durationMs,
                  status_message: statusMessage,
                  attributes,
                },
                request,
              );
            }

            // Check for slow database queries → create slow_query events
            if (attributes['db.system'] && durationMs > 1000) {
              await createTraceEvent(
                sql,
                anomalyDetector,
                incidentService,
                projectId,
                'slow_query',
                'medium',
                `Slow ${attributes['db.system']} query in ${serviceName}: ${otlpSpan.name} (${durationMs}ms)`,
                {
                  trace_id: otlpSpan.traceId,
                  span_id: otlpSpan.spanId,
                  service_name: serviceName,
                  operation_name: otlpSpan.name,
                  duration_ms: durationMs,
                  db_system: attributes['db.system'],
                  db_statement: attributes['db.statement'],
                  attributes,
                },
                request,
              );
            }
          }
        }
      }

      fastify.log.info(`OTLP traces ingested: ${spanCount} spans for project ${projectId}`);

      // Return OTLP success response
      return { partialSuccess: {} };
    } catch (error) {
      request.log.error(error);
      reply.code(500);
      return { error: 'Failed to ingest traces' };
    }
  });

  // POST /v1/metrics — OTLP JSON metric ingest (acknowledge only for now)
  fastify.post<{ Body: OtlpMetricPayload }>('/v1/metrics', async (request) => {
    const projectId = request.headers['x-scanwarp-project-id'] as string | undefined;
    const metricCount = request.body.resourceMetrics?.length ?? 0;

    fastify.log.info(
      `OTLP metrics received: ${metricCount} resource metrics for project ${projectId ?? 'unknown'}`
    );

    // Acknowledge — full metric storage comes later
    return { partialSuccess: {} };
  });

  // GET /traces — list recent traces (grouped by trace_id, returning root spans)
  fastify.get('/traces', async (request, reply) => {
    const { project_id, limit = 20, status } = request.query as {
      project_id?: string;
      limit?: number;
      status?: 'error' | 'ok';
    };

    if (!project_id) {
      reply.code(400);
      return { error: 'project_id is required' };
    }

    try {
      let rootSpans;

      if (status === 'error') {
        // Find traces that contain at least one ERROR span
        rootSpans = await sql`
          SELECT DISTINCT ON (s.trace_id) s.*
          FROM spans s
          WHERE s.project_id = ${project_id}
            AND s.parent_span_id IS NULL
            AND EXISTS (
              SELECT 1 FROM spans e
              WHERE e.trace_id = s.trace_id
                AND e.status_code = 'ERROR'
            )
          ORDER BY s.trace_id, s.start_time ASC
        `;
        // Sort by start_time desc and limit
        rootSpans = rootSpans
          .sort((a, b) =>
            Number(b.start_time) - Number(a.start_time))
          .slice(0, Number(limit));
      } else if (status === 'ok') {
        // Find traces with no ERROR spans
        rootSpans = await sql`
          SELECT DISTINCT ON (s.trace_id) s.*
          FROM spans s
          WHERE s.project_id = ${project_id}
            AND s.parent_span_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM spans e
              WHERE e.trace_id = s.trace_id
                AND e.status_code = 'ERROR'
            )
          ORDER BY s.trace_id, s.start_time ASC
        `;
        rootSpans = rootSpans
          .sort((a, b) =>
            Number(b.start_time) - Number(a.start_time))
          .slice(0, Number(limit));
      } else {
        rootSpans = await sql`
          SELECT * FROM spans
          WHERE project_id = ${project_id}
            AND parent_span_id IS NULL
          ORDER BY start_time DESC
          LIMIT ${Number(limit)}
        `;
      }

      // For each root span, get a summary (span count, has errors, total duration)
      const traces = [];
      for (const root of rootSpans) {
        const stats = await sql`
          SELECT
            COUNT(*)::int AS span_count,
            MAX(duration_ms)::int AS max_duration_ms,
            BOOL_OR(status_code = 'ERROR') AS has_errors
          FROM spans
          WHERE trace_id = ${root.trace_id}
        `;

        traces.push({
          trace_id: root.trace_id,
          root_span: root,
          span_count: stats[0].span_count,
          max_duration_ms: stats[0].max_duration_ms,
          has_errors: stats[0].has_errors,
        });
      }

      return { traces };
    } catch (error) {
      request.log.error(error);
      reply.code(500);
      return { error: 'Failed to fetch traces' };
    }
  });

  // GET /traces/:traceId — fetch all spans for a trace
  fastify.get<{ Params: { traceId: string } }>('/traces/:traceId', async (request, reply) => {
    const { traceId } = request.params;

    try {
      const spans = await sql`
        SELECT * FROM spans
        WHERE trace_id = ${traceId}
        ORDER BY start_time ASC
      `;

      if (spans.length === 0) {
        reply.code(404);
        return { error: 'Trace not found' };
      }

      return { trace_id: traceId, spans };
    } catch (error) {
      request.log.error(error);
      reply.code(500);
      return { error: 'Failed to fetch trace' };
    }
  });

  // GET /incidents/:id/traces — fetch traces related to an incident
  fastify.get<{ Params: { id: string } }>('/incidents/:id/traces', async (request, reply) => {
    const { id } = request.params;

    try {
      // Fetch the incident's events
      const incidents = await sql<Array<{
        events: string[];
        project_id: string;
        created_at: Date;
      }>>`
        SELECT events, project_id, created_at FROM incidents WHERE id = ${id}
      `;

      if (incidents.length === 0) {
        reply.code(404);
        return { error: 'Incident not found' };
      }

      const incident = incidents[0];
      const eventIds = incident.events;

      // Fetch events to find trace IDs
      const events = await sql<Array<{
        raw_data: Record<string, unknown> | null;
        created_at: Date;
      }>>`
        SELECT raw_data, created_at FROM events WHERE id = ANY(${eventIds})
      `;

      // Extract direct trace IDs from event raw_data
      const traceIds: string[] = [];
      for (const event of events) {
        const traceId = event.raw_data?.['trace_id'];
        if (typeof traceId === 'string') {
          traceIds.push(traceId);
        }
      }

      let spans;

      if (traceIds.length > 0) {
        spans = await sql`
          SELECT * FROM spans
          WHERE trace_id = ANY(${traceIds})
          ORDER BY start_time ASC
          LIMIT 200
        `;
      } else {
        // Fallback: time window around the incident
        const timestamps = events.map((e) => e.created_at.getTime());
        const minTime = Math.min(...timestamps) - 2 * 60 * 1000;
        const maxTime = Math.max(...timestamps) + 2 * 60 * 1000;

        const rootSpans = await sql<Array<{ trace_id: string }>>`
          SELECT DISTINCT trace_id
          FROM spans
          WHERE project_id = ${incident.project_id}
            AND parent_span_id IS NULL
            AND start_time >= ${minTime}
            AND start_time <= ${maxTime}
          ORDER BY start_time DESC
          LIMIT 5
        `;

        if (rootSpans.length === 0) {
          return { incident_id: id, spans: [] };
        }

        const nearbyTraceIds = rootSpans.map((r) => r.trace_id);
        spans = await sql`
          SELECT * FROM spans
          WHERE trace_id = ANY(${nearbyTraceIds})
          ORDER BY start_time ASC
          LIMIT 200
        `;
      }

      return { incident_id: id, spans };
    } catch (error) {
      request.log.error(error);
      reply.code(500);
      return { error: 'Failed to fetch traces for incident' };
    }
  });
}

/**
 * Extract the service.name attribute from an OTLP resource.
 */
function extractServiceName(resource?: OtlpResource): string | undefined {
  if (!resource?.attributes) return undefined;

  for (const attr of resource.attributes) {
    if (attr.key === 'service.name') {
      return attr.value.stringValue;
    }
  }

  return undefined;
}

/**
 * Flatten OTLP attributes array into a plain key-value object.
 */
function flattenAttributes(attrs?: OtlpAttribute[]): Record<string, unknown> {
  if (!attrs) return {};

  const result: Record<string, unknown> = {};
  for (const attr of attrs) {
    const val = attr.value;
    if (val.stringValue !== undefined) result[attr.key] = val.stringValue;
    else if (val.intValue !== undefined) result[attr.key] = Number(val.intValue);
    else if (val.doubleValue !== undefined) result[attr.key] = val.doubleValue;
    else if (val.boolValue !== undefined) result[attr.key] = val.boolValue;
  }
  return result;
}

/**
 * Create a ScanWarp event from a trace span and run it through the anomaly detection pipeline.
 */
async function createTraceEvent(
  sql: postgres.Sql,
  anomalyDetector: AnomalyDetector,
  incidentService: IncidentService,
  projectId: string,
  type: 'trace_error' | 'slow_query',
  severity: string,
  message: string,
  rawData: Record<string, unknown>,
  request: { log: { error: (obj: unknown, msg?: string) => void } },
) {
  const result = await sql<Array<{
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
    INSERT INTO events (
      project_id, type, source, message, raw_data, severity, created_at
    ) VALUES (
      ${projectId},
      ${type},
      'otel',
      ${message},
      ${JSON.stringify(rawData)},
      ${severity},
      NOW()
    )
    RETURNING *
  `;

  const eventRow = result[0];
  const event = {
    id: eventRow.id,
    project_id: eventRow.project_id,
    monitor_id: eventRow.monitor_id || undefined,
    type: eventRow.type as 'trace_error' | 'slow_query',
    source: eventRow.source as 'otel',
    message: eventRow.message,
    raw_data: eventRow.raw_data || undefined,
    severity: eventRow.severity as 'high' | 'medium',
    created_at: eventRow.created_at,
  };

  const anomalyResult = await anomalyDetector.analyzeEvent(event);

  if (anomalyResult.shouldDiagnose) {
    await anomalyDetector.markForDiagnosis(event.id, anomalyResult.reason || 'Anomaly detected');

    try {
      await incidentService.createIncident([event.id]);
    } catch (err) {
      request.log.error({ err }, 'Failed to create incident from trace event');
    }
  }
}
