import Fastify from 'fastify';
import cors from '@fastify/cors';
import postgres from 'postgres';
import type { WebhookPayload, VercelLogDrainPayload, Monitor } from '@scanwarp/core';
import { MonitorRunner } from './monitoring/MonitorRunner.js';
import { AnomalyDetector } from './monitoring/AnomalyDetector.js';
import { IncidentService } from './monitoring/IncidentService.js';
import { SupabasePoller } from './monitoring/SupabasePoller.js';
import { StatusChecker } from './monitoring/StatusChecker.js';
import { registerStripeWebhook } from './integrations/stripe.js';
import { registerGitHubWebhook } from './integrations/github.js';
import { registerOtlpRoutes } from './integrations/otlp.js';
import { NotificationManager } from './notifications/manager.js';

const sql = postgres({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'scanwarp',
  username: process.env.POSTGRES_USER || 'scanwarp',
  password: process.env.POSTGRES_PASSWORD || 'scanwarp',
});

const fastify = Fastify({
  logger: true,
  bodyLimit: 1048576 * 5, // 5MB for webhooks
});

fastify.register(cors);

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
const monitorRunner = new MonitorRunner(sql);
const anomalyDetector = new AnomalyDetector(sql);
const incidentService = new IncidentService(sql, process.env.ANTHROPIC_API_KEY);
const statusChecker = new StatusChecker(sql);
const notificationManager = new NotificationManager(sql);

// Initialize optional integrations based on env vars
let supabasePoller: SupabasePoller | null = null;
if (process.env.SUPABASE_PROJECT_REF && process.env.SUPABASE_SERVICE_KEY) {
  supabasePoller = new SupabasePoller(
    sql,
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

// Register provider webhooks
registerStripeWebhook(fastify, sql, process.env.STRIPE_WEBHOOK_SECRET);
registerGitHubWebhook(fastify, sql, process.env.GITHUB_WEBHOOK_SECRET);

// Register OTLP trace/metric ingest routes
registerOtlpRoutes(fastify, sql, anomalyDetector, incidentService);

// Project management endpoints
fastify.post<{ Body: { name: string } }>('/projects', async (request, reply) => {
  const { name } = request.body;

  try {
    const result = await sql<Array<{ id: string }>>`
      INSERT INTO projects (name) VALUES (${name}) RETURNING id
    `;

    return { success: true, id: result[0].id };
  } catch (error) {
    request.log.error(error);
    reply.code(500);
    return { success: false, message: 'Failed to create project' };
  }
});

fastify.get('/projects', async (request) => {
  const { name } = request.query as { name?: string };

  let query = sql`SELECT * FROM projects`;

  if (name) {
    query = sql`SELECT * FROM projects WHERE name = ${name}`;
  }

  const projects = await query;
  return projects;
});

// Monitor management endpoints
fastify.post<{
  Body: { project_id: string; url: string; check_interval_seconds?: number };
}>('/monitors', async (request, reply) => {
  const { project_id, url, check_interval_seconds = 60 } = request.body;

  try {
    const result = await sql<Monitor[]>`
      INSERT INTO monitors (project_id, url, check_interval_seconds)
      VALUES (${project_id}, ${url}, ${check_interval_seconds})
      RETURNING *
    `;

    return { success: true, monitor: result[0] };
  } catch (error) {
    request.log.error(error);
    reply.code(500);
    return { success: false, message: 'Failed to create monitor' };
  }
});

fastify.get('/monitors', async () => {
  const monitors = await sql`
    SELECT * FROM monitors
    ORDER BY created_at DESC
  `;

  return { monitors };
});

fastify.get<{ Params: { id: string } }>('/monitors/:id', async (request, reply) => {
  const { id } = request.params;

  const monitors = await sql<Monitor[]>`
    SELECT * FROM monitors WHERE id = ${id}
  `;

  if (monitors.length === 0) {
    reply.code(404);
    return { error: 'Monitor not found' };
  }

  return { monitor: monitors[0] };
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

  let query = sql`SELECT * FROM events WHERE 1=1`;

  if (monitor_id) {
    query = sql`${query} AND monitor_id = ${monitor_id}`;
  }
  if (project_id) {
    query = sql`${query} AND project_id = ${project_id}`;
  }
  if (type) {
    query = sql`${query} AND type = ${type}`;
  }
  if (source) {
    query = sql`${query} AND source = ${source}`;
  }

  const events = await sql`
    ${query}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

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
        const projectId = await getOrCreateProject(log.deploymentId || log.source);

        // Create event
        const result = await sql<Array<{
          id: string;
          project_id: string;
          monitor_id: string | null;
          type: string;
          source: string;
          message: string;
          raw_data: Record<string, unknown> | null;
          severity: string;
          created_at: Date;
        }>>`
          INSERT INTO events (
            project_id, type, source, message, raw_data, severity, created_at
          ) VALUES (
            ${projectId},
            'error',
            'vercel',
            ${log.message},
            ${JSON.stringify(log)},
            'high',
            NOW()
          )
          RETURNING *
        `;

        // Run anomaly detection
        const eventRow = result[0];
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

// Incident management endpoints
fastify.get('/incidents', async (request) => {
  const { project_id, status, limit = 50 } = request.query as {
    project_id?: string;
    status?: string;
    limit?: number;
  };

  let query = sql`SELECT * FROM incidents WHERE 1=1`;

  if (project_id) {
    query = sql`${query} AND project_id = ${project_id}`;
  }
  if (status) {
    query = sql`${query} AND status = ${status}`;
  }

  const incidents = await sql<Array<{
    id: string;
    project_id: string;
    events: string[];
    status: string;
    diagnosis_text: string | null;
    diagnosis_fix: string | null;
    severity: string;
    fix_prompt: string | null;
    created_at: Date;
    resolved_at: Date | null;
  }>>`
    ${query}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

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
  const events = await sql`
    SELECT * FROM events WHERE id = ANY(${incident.events})
    ORDER BY created_at DESC
  `;

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

// Helper function to get or create project
async function getOrCreateProject(name: string): Promise<string> {
  const existing = await sql<Array<{ id: string }>>`
    SELECT id FROM projects WHERE name = ${name}
  `;

  if (existing.length > 0) {
    return existing[0].id;
  }

  const created = await sql<Array<{ id: string }>>`
    INSERT INTO projects (name) VALUES (${name}) RETURNING id
  `;

  return created[0].id;
}

// ===== WAITLIST ENDPOINTS =====

// Submit email to waitlist
fastify.post('/waitlist', async (request, reply) => {
  const { email } = request.body as { email: string };

  if (!email || !email.includes('@')) {
    return reply.code(400).send({ error: 'Valid email required' });
  }

  try {
    await sql`
      INSERT INTO waitlist (email)
      VALUES (${email.toLowerCase().trim()})
      ON CONFLICT (email) DO NOTHING
    `;

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
    const entries = await sql<Array<{
      id: string;
      email: string;
      created_at: Date;
    }>>`
      SELECT id, email, created_at
      FROM waitlist
      ORDER BY created_at DESC
    `;

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

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000');
    await fastify.listen({ port, host: '0.0.0.0' });

    // Start the monitoring engine
    await monitorRunner.start();

    // Start the provider status checker
    await statusChecker.start();

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
  if (supabasePoller) {
    await supabasePoller.stop();
  }
  await fastify.close();
  await sql.end();
  process.exit(0);
});

start();
