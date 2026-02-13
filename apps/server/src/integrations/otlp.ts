import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/index.js';
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
  db: Database,
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

            await db.insertSpan({
              trace_id: otlpSpan.traceId,
              span_id: otlpSpan.spanId,
              parent_span_id: otlpSpan.parentSpanId || null,
              project_id: projectId,
              service_name: serviceName,
              operation_name: otlpSpan.name,
              kind: SPAN_KIND_MAP[otlpSpan.kind] || 'UNSPECIFIED',
              start_time: startTimeMs,
              duration_ms: durationMs,
              status_code: statusCode,
              status_message: statusMessage,
              attributes,
              events: spanEvents,
            });

            spanCount++;

            // Check for error spans → create trace_error events
            if (statusCode === 'ERROR') {
              await createTraceEvent(
                db,
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
                db,
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
        rootSpans = await db.getErrorRootSpans(project_id);
        rootSpans = rootSpans
          .sort((a, b) => Number(b.start_time) - Number(a.start_time))
          .slice(0, Number(limit));
      } else if (status === 'ok') {
        rootSpans = await db.getOkRootSpans(project_id);
        rootSpans = rootSpans
          .sort((a, b) => Number(b.start_time) - Number(a.start_time))
          .slice(0, Number(limit));
      } else {
        rootSpans = await db.getRootSpans(project_id, Number(limit));
      }

      // For each root span, get a summary (span count, has errors, total duration)
      const traces = [];
      for (const root of rootSpans) {
        const stats = await db.getTraceStats(root.trace_id);

        traces.push({
          trace_id: root.trace_id,
          root_span: root,
          span_count: stats.span_count,
          max_duration_ms: stats.max_duration_ms,
          has_errors: stats.has_errors,
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
      const spans = await db.getSpansByTraceId(traceId);

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
      const incident = await db.getIncident(id);

      if (!incident) {
        reply.code(404);
        return { error: 'Incident not found' };
      }

      const eventIds = incident.events;
      const events = await db.getEventsByIds(eventIds);

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
        spans = await db.getSpansByTraceIds(traceIds, 200);
      } else {
        // Fallback: time window around the incident
        const timestamps = events.map((e) => e.created_at.getTime());
        const minTime = Math.min(...timestamps) - 2 * 60 * 1000;
        const maxTime = Math.max(...timestamps) + 2 * 60 * 1000;

        const nearbyTraceIds = await db.getDistinctTraceIdsInWindow(
          incident.project_id,
          minTime,
          maxTime,
          5
        );

        if (nearbyTraceIds.length === 0) {
          return { incident_id: id, spans: [] };
        }

        spans = await db.getSpansByTraceIds(nearbyTraceIds, 200);
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
  db: Database,
  anomalyDetector: AnomalyDetector,
  incidentService: IncidentService,
  projectId: string,
  type: 'trace_error' | 'slow_query',
  severity: string,
  message: string,
  rawData: Record<string, unknown>,
  request: { log: { error: (obj: unknown, msg?: string) => void } },
) {
  const eventRow = await db.createEvent({
    project_id: projectId,
    type,
    source: 'otel',
    message,
    raw_data: rawData,
    severity,
  });

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
