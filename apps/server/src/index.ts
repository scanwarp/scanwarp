import Fastify from 'fastify';
import cors from '@fastify/cors';
import postgres from 'postgres';
import type { WebhookPayload } from '@scanwarp/core';

const sql = postgres({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'scanwarp',
  username: process.env.POSTGRES_USER || 'scanwarp',
  password: process.env.POSTGRES_PASSWORD || 'scanwarp',
});

const fastify = Fastify({
  logger: true,
});

fastify.register(cors);

fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

fastify.post<{ Body: WebhookPayload }>('/webhook', async (request, reply) => {
  const { event, service, data, timestamp } = request.body;

  try {
    await sql`
      INSERT INTO webhook_events (event, service, data, timestamp)
      VALUES (${event}, ${service}, ${JSON.stringify(data)}, ${timestamp})
    `;

    return { success: true, message: 'Webhook received' };
  } catch (error) {
    request.log.error(error);
    reply.code(500);
    return { success: false, message: 'Failed to process webhook' };
  }
});

fastify.get('/events', async () => {
  const events = await sql`
    SELECT * FROM webhook_events
    ORDER BY timestamp DESC
    LIMIT 100
  `;

  return { events };
});

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000');
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
