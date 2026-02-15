import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'crypto';

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Compare against self to maintain constant time even on length mismatch
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * API key authentication middleware.
 * When API_TOKEN env var is set, all non-public routes require a valid API key
 * via the Authorization header (Bearer token) or x-api-key header.
 *
 * Public routes (health, waitlist POST, webhooks, browser script) are excluded.
 */
export async function authMiddleware(fastify: FastifyInstance) {
  const apiToken = process.env.API_TOKEN;

  if (!apiToken) {
    return; // No API_TOKEN configured — all routes are open
  }

  const publicPaths = new Set([
    '/health',
    '/webhook',
    '/ingest/vercel',
    '/api/browser-errors',
    '/browser.js',
  ]);

  const publicPrefixes = [
    '/webhook/',
    '/ingest/',
  ];

  // Methods/paths that are public without auth
  const publicMethodPaths = new Set([
    'POST:/waitlist',
  ]);

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url.split('?')[0];

    // Skip auth for public paths
    if (publicPaths.has(url)) return;
    if (publicPrefixes.some((p) => url.startsWith(p))) return;
    if (publicMethodPaths.has(`${request.method}:${url}`)) return;

    // Allow serving dashboard static assets (only exact known extensions at root)
    if (request.method === 'GET' && (url === '/' || url === '/index.html')) {
      return;
    }

    // Check for API key
    const authHeader = request.headers.authorization;
    const token =
      (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined) ||
      (request.headers['x-api-key'] as string);

    if (!token || !timingSafeCompare(token, apiToken)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });
}
