import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import type { WebhookPayload, VercelLogDrainPayload } from '@scanwarp/core';
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

const db = createDatabase();

const fastify = Fastify({
  logger: true,
  bodyLimit: 1048576 * 5, // 5MB for webhooks
});

fastify.register(cors);

// Serve the dashboard SPA if the built files exist
const dashboardDir = path.join(__dirname, 'dashboard');
if (fs.existsSync(dashboardDir) && fs.existsSync(path.join(dashboardDir, 'index.html'))) {
  fastify.register(fastifyStatic, {
    root: dashboardDir,
    prefix: '/',
    decorateReply: false,
    // Don't interfere with API routes
    wildcard: false,
  });

  // SPA fallback: serve index.html for any non-API, non-file route
  fastify.setNotFoundHandler(async (_request, reply) => {
    return reply.sendFile('index.html', dashboardDir);
  });

  console.log('Dashboard enabled — serving from', dashboardDir);
}

// Serve browser monitoring script
fastify.get('/browser.js', async (_request, reply) => {
  // Look for the @scanwarp/browser package in node_modules
  const browserScriptPath = path.join(__dirname, '..', 'node_modules', '@scanwarp', 'browser', 'dist', 'index.min.js');

  if (fs.existsSync(browserScriptPath)) {
    reply.type('application/javascript');
    return fs.readFileSync(browserScriptPath, 'utf-8');
  }

  // Fallback: return a minimal error handler if package not found
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

// Wire provider tracker into incident service for outage correlation
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

// Register provider webhooks
registerStripeWebhook(fastify, db, process.env.STRIPE_WEBHOOK_SECRET);
registerGitHubWebhook(fastify, db, process.env.GITHUB_WEBHOOK_SECRET);

// Register OTLP trace/metric ingest routes
registerOtlpRoutes(fastify, db, anomalyDetector, incidentService);

// Project management endpoints
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

// Monitor management endpoints
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

// Events endpoints
fastify.get('/events', async (request) => {
  const { monitor_id, project_id, type, source, limit = 100 } = request.query as {
    monitor_id?: string;
    project_id?: string;
    type?: string;
    source?: string;
    limit?: number;
  };

  const events = await db.getEvents({ monitor_id, project_id, type, source, limit });
  return { events };
});

// Vercel log drain webhook endpoint
fastify.post<{ Body: VercelLogDrainPayload[] }>('/ingest/vercel', async (request, reply) => {
  const logs = Array.isArray(request.body) ? request.body : [request.body];

  try {
    let errorCount = 0;

    for (const log of logs) {
      // Only process error-level logs
      if (log.level === 'error') {
        // Find or create a project for this deployment
        const { id: projectId } = await db.getOrCreateProject(log.deploymentId || log.source);

        // Create event
        const eventRow = await db.createEvent({
          project_id: projectId,
          type: 'error',
          source: 'vercel',
          message: log.message,
          raw_data: log as unknown as Record<string, unknown>,
          severity: 'high',
        });

        // Run anomaly detection
        const event = {
          id: eventRow.id,
          project_id: eventRow.project_id,
          monitor_id: eventRow.monitor_id || undefined,
          type: eventRow.type as 'error',
          source: eventRow.source as 'vercel',
          message: eventRow.message,
          raw_data: eventRow.raw_data || undefined,
          severity: eventRow.severity as 'high',
          created_at: eventRow.created_at,
        };
        const anomalyResult = await anomalyDetector.analyzeEvent(event);

        if (anomalyResult.shouldDiagnose) {
          await anomalyDetector.markForDiagnosis(event.id, anomalyResult.reason || 'Anomaly detected');

          // Create incident with AI diagnosis
          try {
            await incidentService.createIncident([event.id]);
          } catch (err) {
            request.log.error({ err }, 'Failed to create incident');
          }
        }

        errorCount++;
      }
    }

    return {
      success: true,
      message: `Processed ${logs.length} logs, created ${errorCount} error events`,
    };
  } catch (error) {
    request.log.error(error);
    reply.code(500);
    return { success: false, message: 'Failed to process Vercel logs' };
  }
});

// Legacy webhook endpoint
fastify.post<{ Body: WebhookPayload }>('/webhook', async (request, reply) => {
  const { event, service, data, timestamp } = request.body;

  try {
    await db.insertWebhookEvent(event, service, data, timestamp);

    return { success: true, message: 'Webhook received' };
  } catch (error) {
    request.log.error(error);
    reply.code(500);
    return { success: false, message: 'Failed to process webhook' };
  }
});

// Incident management endpoints
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

  // Also fetch the related events
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

// Notification channel management endpoints
fastify.post<{
  Body: { project_id: string; type: 'discord' | 'slack'; webhook_url: string };
}>('/channels', async (request, reply) => {
  const { project_id, type, webhook_url } = request.body;

  try {
    const channel = await notificationManager.createChannel(
      project_id,
      type,
      webhook_url
    );
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

// ===== WAITLIST ENDPOINTS =====

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
      entries: entries.map(e => ({
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

// Browser error tracking endpoint
fastify.post<{
  Headers: { 'x-scanwarp-project-id': string };
  Body: {
    errors: Array<{
      type: string;
      message: string;
      stack?: string;
      timestamp: number;
      url: string;
      userAgent: string;
      filename?: string;
      lineno?: number;
      colno?: number;
      sessionId: string;
    }>;
  };
}>('/api/browser-errors', async (request, reply) => {
  const projectId = request.headers['x-scanwarp-project-id'];

  if (!projectId) {
    return reply.code(400).send({ error: 'Missing x-scanwarp-project-id header' });
  }

  const { errors } = request.body;

  if (!errors || !Array.isArray(errors)) {
    return reply.code(400).send({ error: 'Missing or invalid errors array' });
  }

  try {
    let createdCount = 0;

    for (const error of errors) {
      // Create event for each browser error
      const eventRow = await db.createEvent({
        project_id: projectId,
        type: 'error',
        source: 'browser',
        message: `[${error.type}] ${error.message}`,
        raw_data: error as unknown as Record<string, unknown>,
        severity: error.type === 'blank_screen' || error.type === 'unhandled_error' ? 'high' : 'medium',
      });

      // Run anomaly detection
      const event = {
        id: eventRow.id,
        project_id: eventRow.project_id,
        monitor_id: eventRow.monitor_id || undefined,
        type: eventRow.type as 'error',
        source: eventRow.source as 'browser',
        message: eventRow.message,
        raw_data: eventRow.raw_data || undefined,
        severity: eventRow.severity as 'high' | 'medium',
        created_at: eventRow.created_at,
      };

      const anomalyResult = await anomalyDetector.analyzeEvent(event);

      if (anomalyResult.shouldDiagnose) {
        await anomalyDetector.markForDiagnosis(event.id, anomalyResult.reason || 'Browser error anomaly detected');

        // Create incident with AI diagnosis
        try {
          await incidentService.createIncident([event.id]);
        } catch (err) {
          request.log.error({ err }, 'Failed to create incident for browser error');
        }
      }

      createdCount++;
    }

    return {
      success: true,
      message: `Processed ${errors.length} browser errors`,
      created: createdCount,
    };
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ success: false, message: 'Failed to process browser errors' });
  }
});

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000');
    await fastify.listen({ port, host: '0.0.0.0' });

    // Start the monitoring engine
    await monitorRunner.start();

    // Start the provider status checker (DB-backed)
    await statusChecker.start();

    // Start the in-memory provider status tracker (for incident correlation)
    await providerTracker.start();

    // Start optional integrations
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
