import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { createDatabase } from './db/index.js';
import { MonitorRunner } from './monitoring/MonitorRunner.js';
import { AnomalyDetector } from './monitoring/AnomalyDetector.js';
import { IncidentService } from './monitoring/IncidentService.js';
import { SupabasePoller } from './monitoring/SupabasePoller.js';
import { StatusChecker } from './monitoring/StatusChecker.js';
import { registerStripeWebhook } from './integrations/stripe.js';
import { registerGitHubWebhook } from './integrations/github.js';
import { registerOtlpRoutes } from './integrations/otlp.js';
import { NotificationManager } from './notifications/manager.js';
import { ProviderStatusTracker } from './providers/status.js';
import { authMiddleware } from './middleware/auth.js';
import { projectRoutes } from './routes/projects.js';
import { monitorRoutes } from './routes/monitors.js';
import { eventRoutes } from './routes/events.js';
import { incidentRoutes } from './routes/incidents.js';
import { channelRoutes } from './routes/channels.js';
import { adminRoutes } from './routes/admin.js';

const db = createDatabase();

const fastify = Fastify({
  logger: true,
  bodyLimit: 1048576 * 5, // 5MB for webhooks
});

fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
});

// Serve the dashboard SPA if the built files exist
const dashboardDir = path.join(__dirname, 'dashboard');
if (fs.existsSync(dashboardDir) && fs.existsSync(path.join(dashboardDir, 'index.html'))) {
  fastify.register(fastifyStatic, {
    root: dashboardDir,
    prefix: '/',
    decorateReply: false,
    wildcard: false,
  });

  fastify.setNotFoundHandler(async (_request, reply) => {
    return reply.sendFile('index.html', dashboardDir);
  });

  console.log('Dashboard enabled — serving from', dashboardDir);
}

// Serve browser monitoring script
fastify.get('/browser.js', async (_request, reply) => {
  const browserScriptPath = path.join(__dirname, '..', 'node_modules', '@scanwarp', 'browser', 'dist', 'index.min.js');

  if (fs.existsSync(browserScriptPath)) {
    reply.type('application/javascript');
    return fs.readFileSync(browserScriptPath, 'utf-8');
  }

  reply.type('application/javascript');
  return `console.warn('[ScanWarp] Browser monitoring script not found. Install @scanwarp/browser package.');`;
});

// Add raw body support for webhook signature verification
fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  try {
    const json = JSON.parse(body.toString());
    (req as { rawBody?: Buffer }).rawBody = body as Buffer;
    done(null, json);
  } catch (err) {
    done(err instanceof Error ? err : new Error(String(err)), undefined);
  }
});

// Initialize monitoring components
const monitorRunner = new MonitorRunner(db);
const anomalyDetector = new AnomalyDetector(db);
const incidentService = new IncidentService(db, process.env.ANTHROPIC_API_KEY);
const statusChecker = new StatusChecker(db);
const notificationManager = new NotificationManager(db);
const providerTracker = new ProviderStatusTracker();

incidentService.setProviderTracker(providerTracker);

// Initialize optional integrations based on env vars
let supabasePoller: SupabasePoller | null = null;
if (process.env.SUPABASE_PROJECT_REF && process.env.SUPABASE_SERVICE_KEY) {
  supabasePoller = new SupabasePoller(
    db,
    process.env.SUPABASE_PROJECT_REF,
    process.env.SUPABASE_SERVICE_KEY
  );
  console.log('Supabase integration enabled');
} else {
  console.log('Supabase integration disabled (missing env vars)');
}

// Security headers
fastify.addHook('onSend', async (_request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '0');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

// Register auth middleware (optional — only active when API_TOKEN is set)
fastify.register(authMiddleware);

// Register provider webhooks
registerStripeWebhook(fastify, db, process.env.STRIPE_WEBHOOK_SECRET);
registerGitHubWebhook(fastify, db, process.env.GITHUB_WEBHOOK_SECRET);
registerOtlpRoutes(fastify, db, anomalyDetector, incidentService);

// Register route modules
fastify.register(adminRoutes, { db, providerTracker });
fastify.register(projectRoutes, { db });
fastify.register(monitorRoutes, { db });
fastify.register(eventRoutes, { db, anomalyDetector, incidentService });
fastify.register(incidentRoutes, { db, incidentService });
fastify.register(channelRoutes, { notificationManager });

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000');
    await fastify.listen({ port, host: '0.0.0.0' });

    await monitorRunner.start();
    await statusChecker.start();
    await providerTracker.start();

    if (supabasePoller) {
      await supabasePoller.start();
    }

    console.log(`Server listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await monitorRunner.stop();
  await statusChecker.stop();
  await providerTracker.stop();
  if (supabasePoller) {
    await supabasePoller.stop();
  }
  await fastify.close();
  await db.close();
  process.exit(0);
});

start();
