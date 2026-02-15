import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/index.js';
import { validateExternalURL } from '../utils/url-validation.js';

export async function monitorRoutes(fastify: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  fastify.post<{
    Body: { project_id: string; url: string; check_interval_seconds?: number };
  }>('/monitors', async (request, reply) => {
    const { project_id, url, check_interval_seconds = 60 } = request.body;

    // Validate URL (SSRF protection)
    const urlCheck = validateExternalURL(url);
    if (!urlCheck.valid) {
      reply.code(400);
      return { success: false, message: urlCheck.error };
    }

    // Validate check interval (10s - 3600s)
    const interval = Math.max(10, Math.min(3600, check_interval_seconds));

    try {
      const monitor = await db.createMonitor(project_id, url, interval);
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
