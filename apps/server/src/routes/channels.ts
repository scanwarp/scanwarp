import type { FastifyInstance } from 'fastify';
import type { NotificationManager } from '../notifications/manager.js';

export async function channelRoutes(
  fastify: FastifyInstance,
  opts: { notificationManager: NotificationManager }
) {
  const { notificationManager } = opts;

  fastify.post<{
    Body: { project_id: string; type: 'discord' | 'slack'; webhook_url: string };
  }>('/channels', async (request, reply) => {
    const { project_id, type, webhook_url } = request.body;

    try {
      const channel = await notificationManager.createChannel(project_id, type, webhook_url);
      return { success: true, channel };
    } catch (error) {
      request.log.error(error);
      reply.code(500);
      return { success: false, message: 'Failed to create channel' };
    }
  });

  fastify.get('/channels', async (request) => {
    const { project_id } = request.query as { project_id?: string };

    if (!project_id) {
      return { error: 'project_id is required' };
    }

    try {
      const channels = await notificationManager.getChannels(project_id);
      return { channels };
    } catch (error) {
      return { error: 'Failed to fetch channels' };
    }
  });

  fastify.delete<{ Params: { id: string } }>('/channels/:id', async (request, reply) => {
    const { id } = request.params;

    try {
      await notificationManager.deleteChannel(id);
      return { success: true, message: 'Channel deleted' };
    } catch (error) {
      request.log.error(error);
      reply.code(500);
      return { success: false, message: 'Failed to delete channel' };
    }
  });

  fastify.post<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/channels/:id/toggle',
    async (request, reply) => {
      const { id } = request.params;
      const { enabled } = request.body;

      try {
        await notificationManager.toggleChannel(id, enabled);
        return { success: true, message: `Channel ${enabled ? 'enabled' : 'disabled'}` };
      } catch (error) {
        request.log.error(error);
        reply.code(500);
        return { success: false, message: 'Failed to toggle channel' };
      }
    }
  );

  fastify.post<{ Params: { id: string } }>('/channels/:id/test', async (request, reply) => {
    const { id } = request.params;

    try {
      await notificationManager.testChannel(id);
      return { success: true, message: 'Test notification sent' };
    } catch (error) {
      request.log.error(error);
      reply.code(500);
      return { success: false, message: 'Failed to send test notification' };
    }
  });
}
