import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/index.js';

export async function monitorRoutes(fastify: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  fastify.post<{
    Body: { project_id: string; url: string; check_interval_seconds?: number };
  }>('/monitors', async (request, reply) => {
    const { project_id, url, check_interval_seconds = 60 } = request.body;

    try {
      const monitor = await db.createMonitor(project_id, url, check_interval_seconds);
      return { success: true, monitor };
    } catch (error) {
      request.log.error(error);
      reply.code(500);
      return { success: false, message: 'Failed to create monitor' };
    }
  });

  fastify.get('/monitors', async () => {
    const monitors = await db.getMonitors();
    return { monitors };
  });

  fastify.get<{ Params: { id: string } }>('/monitors/:id', async (request, reply) => {
    const { id } = request.params;
    const monitor = await db.getMonitorById(id);

    if (!monitor) {
      reply.code(404);
      return { error: 'Monitor not found' };
    }

    return { monitor };
  });
}
