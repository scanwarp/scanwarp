import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/index.js';
import type { ProviderStatusTracker } from '../providers/status.js';

export async function adminRoutes(
  fastify: FastifyInstance,
  opts: { db: Database; providerTracker: ProviderStatusTracker }
) {
  const { db, providerTracker } = opts;

  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.get('/provider-status', async () => {
    const statuses = providerTracker.getAll();
    const nonOperational = providerTracker.getNonOperational();

    return {
      providers: statuses.map((s) => ({
        provider: s.provider,
        displayName: s.displayName,
        status: s.status,
        description: s.description,
        lastCheckedAt: s.lastCheckedAt.toISOString(),
      })),
      hasIssues: nonOperational.length > 0,
      issueCount: nonOperational.length,
    };
  });

  // Submit email to waitlist
  fastify.post('/waitlist', async (request, reply) => {
    const { email } = request.body as { email: string };

    if (!email || !email.includes('@')) {
      return reply.code(400).send({ error: 'Valid email required' });
    }

    try {
      await db.addToWaitlist(email);
      return { success: true, message: 'Added to waitlist' };
    } catch (err) {
      request.log.error({ err }, 'Failed to add to waitlist');
      return reply.code(500).send({ error: 'Failed to add to waitlist' });
    }
  });

  // Get all waitlist entries (admin only - requires API token)
  fastify.get('/waitlist', async (request, reply) => {
    const token = request.headers.authorization?.replace('Bearer ', '');
    const apiToken = process.env.API_TOKEN;

    if (!apiToken || token !== apiToken) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    try {
      const entries = await db.getWaitlist();

      return {
        count: entries.length,
        entries: entries.map((e) => ({
          id: e.id,
          email: e.email,
          created_at: e.created_at,
        })),
      };
    } catch (err) {
      request.log.error({ err }, 'Failed to fetch waitlist');
      return reply.code(500).send({ error: 'Failed to fetch waitlist' });
    }
  });
}
