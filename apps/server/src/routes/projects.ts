import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/index.js';

export async function projectRoutes(fastify: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  fastify.post<{ Body: { name: string } }>('/projects', async (request, reply) => {
    const { name } = request.body;

    try {
      const result = await db.createProject(name);
      return { success: true, id: result.id };
    } catch (error) {
      request.log.error(error);
      reply.code(500);
      return { success: false, message: 'Failed to create project' };
    }
  });

  fastify.get('/projects', async (request) => {
    const { name } = request.query as { name?: string };
    const projects = await db.getProjects(name || undefined);
    return projects;
  });
}
