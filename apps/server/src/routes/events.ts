import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/index.js';
import type { VercelLogDrainPayload, WebhookPayload } from '@scanwarp/core';
import type { AnomalyDetector } from '../monitoring/AnomalyDetector.js';
import type { IncidentService } from '../monitoring/IncidentService.js';

interface EventRoutesOpts {
  db: Database;
  anomalyDetector: AnomalyDetector;
  incidentService: IncidentService;
}

export async function eventRoutes(fastify: FastifyInstance, opts: EventRoutesOpts) {
  const { db, anomalyDetector, incidentService } = opts;

  fastify.get('/events', async (request) => {
    const { monitor_id, project_id, type, source, limit = 100 } = request.query as {
      monitor_id?: string;
      project_id?: string;
      type?: string;
      source?: string;
      limit?: number;
    };

    const clampedLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
    const events = await db.getEvents({ monitor_id, project_id, type, source, limit: clampedLimit });
    return { events };
  });

  // Vercel log drain webhook endpoint
  fastify.post<{ Body: VercelLogDrainPayload[] }>('/ingest/vercel', async (request, reply) => {
    const logs = Array.isArray(request.body) ? request.body : [request.body];

    try {
      let errorCount = 0;

      for (const log of logs) {
        if (log.level === 'error') {
          const { id: projectId } = await db.getOrCreateProject(log.deploymentId || log.source);

          const eventRow = await db.createEvent({
            project_id: projectId,
            type: 'error',
            source: 'vercel',
            message: log.message,
            raw_data: log as unknown as Record<string, unknown>,
            severity: 'high',
          });

          const event = {
            id: eventRow.id,
            project_id: eventRow.project_id,
            monitor_id: eventRow.monitor_id || undefined,
            type: eventRow.type as 'error',
            source: eventRow.source as 'vercel',
            message: eventRow.message,
            raw_data: eventRow.raw_data || undefined,
            severity: eventRow.severity as 'high',
            created_at: eventRow.created_at,
          };
          const anomalyResult = await anomalyDetector.analyzeEvent(event);

          if (anomalyResult.shouldDiagnose) {
            await anomalyDetector.markForDiagnosis(event.id, anomalyResult.reason || 'Anomaly detected');
            try {
              await incidentService.createIncident([event.id]);
            } catch (err) {
              request.log.error({ err }, 'Failed to create incident');
            }
          }

          errorCount++;
        }
      }

      return {
        success: true,
        message: `Processed ${logs.length} logs, created ${errorCount} error events`,
      };
    } catch (error) {
      request.log.error(error);
      reply.code(500);
      return { success: false, message: 'Failed to process Vercel logs' };
    }
  });

  // Legacy webhook endpoint
  fastify.post<{ Body: WebhookPayload }>('/webhook', async (request, reply) => {
    const { event, service, data, timestamp } = request.body;

    try {
      await db.insertWebhookEvent(event, service, data, timestamp);
      return { success: true, message: 'Webhook received' };
    } catch (error) {
      request.log.error(error);
      reply.code(500);
      return { success: false, message: 'Failed to process webhook' };
    }
  });

  // Browser error tracking endpoint
  fastify.post<{
    Headers: { 'x-scanwarp-project-id': string };
    Body: {
      errors: Array<{
        type: string;
        message: string;
        stack?: string;
        timestamp: number;
        url: string;
        userAgent: string;
        filename?: string;
        lineno?: number;
        colno?: number;
        sessionId: string;
      }>;
    };
  }>('/api/browser-errors', async (request, reply) => {
    const projectId = request.headers['x-scanwarp-project-id'];

    if (!projectId) {
      return reply.code(400).send({ error: 'Missing x-scanwarp-project-id header' });
    }

    const { errors } = request.body;

    if (!errors || !Array.isArray(errors)) {
      return reply.code(400).send({ error: 'Missing or invalid errors array' });
    }

    if (errors.length > 100) {
      return reply.code(400).send({ error: 'Too many errors in a single request (max 100)' });
    }

    try {
      let createdCount = 0;

      for (const error of errors) {
        const eventRow = await db.createEvent({
          project_id: projectId,
          type: 'error',
          source: 'browser',
          message: `[${error.type}] ${error.message}`,
          raw_data: error as unknown as Record<string, unknown>,
          severity: error.type === 'blank_screen' || error.type === 'unhandled_error' ? 'high' : 'medium',
        });

        const event = {
          id: eventRow.id,
          project_id: eventRow.project_id,
          monitor_id: eventRow.monitor_id || undefined,
          type: eventRow.type as 'error',
          source: eventRow.source as 'browser',
          message: eventRow.message,
          raw_data: eventRow.raw_data || undefined,
          severity: eventRow.severity as 'high' | 'medium',
          created_at: eventRow.created_at,
        };

        const anomalyResult = await anomalyDetector.analyzeEvent(event);

        if (anomalyResult.shouldDiagnose) {
          await anomalyDetector.markForDiagnosis(event.id, anomalyResult.reason || 'Browser error anomaly detected');
          try {
            await incidentService.createIncident([event.id]);
          } catch (err) {
            request.log.error({ err }, 'Failed to create incident for browser error');
          }
        }

        createdCount++;
      }

      return {
        success: true,
        message: `Processed ${errors.length} browser errors`,
        created: createdCount,
      };
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ success: false, message: 'Failed to process browser errors' });
    }
  });
}
