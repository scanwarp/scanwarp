import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/index.js';
import type { IncidentService } from '../monitoring/IncidentService.js';

export async function incidentRoutes(
  fastify: FastifyInstance,
  opts: { db: Database; incidentService: IncidentService }
) {
  const { db, incidentService } = opts;

  fastify.get('/incidents', async (request) => {
    const { project_id, status, limit = 50 } = request.query as {
      project_id?: string;
      status?: string;
      limit?: number;
    };

    const incidents = await db.getIncidents({ project_id, status, limit });
    return { incidents };
  });

  fastify.get<{ Params: { id: string } }>('/incidents/:id', async (request, reply) => {
    const { id } = request.params;

    const incident = await incidentService.getIncident(id);

    if (!incident) {
      reply.code(404);
      return { error: 'Incident not found' };
    }

    const events = await db.getEventsByIds(incident.events);

    return {
      incident,
      events,
    };
  });

  fastify.post<{ Params: { id: string } }>('/incidents/:id/resolve', async (request, reply) => {
    const { id } = request.params;

    try {
      await incidentService.resolveIncident(id);
      return { success: true, message: 'Incident resolved' };
    } catch (error) {
      request.log.error(error);
      reply.code(500);
      return { success: false, message: 'Failed to resolve incident' };
    }
  });
}
