import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Optional API key authentication middleware.
 * When API_TOKEN env var is set, all non-public routes require a valid API key
 * via the Authorization header (Bearer token) or x-api-key header.
 *
 * Public routes (health, waitlist POST, webhooks) are excluded.
 */
export async function authMiddleware(fastify: FastifyInstance) {
  const apiToken = process.env.API_TOKEN;

  if (!apiToken) {
    return; // No API_TOKEN configured — all routes are open
  }

  const publicPaths = new Set([
    '/health',
    '/waitlist',         // POST is public, GET requires admin token (handled in route)
    '/webhook',
    '/ingest/vercel',
    '/api/browser-errors',
    '/browser.js',
  ]);

  const publicPrefixes = [
    '/webhook/',
    '/ingest/',
  ];

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for public paths
    const url = request.url.split('?')[0];
    if (publicPaths.has(url)) return;
    if (publicPrefixes.some((p) => url.startsWith(p))) return;

    // Skip auth for GET /health and static assets
    if (request.method === 'GET' && (url === '/' || url.endsWith('.js') || url.endsWith('.css') || url.endsWith('.html'))) {
      return;
    }

    // Check for API key
    const token =
      request.headers.authorization?.replace('Bearer ', '') ||
      (request.headers['x-api-key'] as string);

    if (token !== apiToken) {
      return reply.code(401).send({ error: 'Unauthorized — set API_TOKEN or provide a valid Bearer token' });
    }
  });
}
