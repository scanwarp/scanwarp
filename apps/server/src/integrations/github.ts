import type { FastifyInstance, FastifyRequest } from 'fastify';
import type postgres from 'postgres';
import crypto from 'crypto';
import type { GitHubWebhookEvent, ProviderEvent } from '@scanwarp/core';

export async function registerGitHubWebhook(
  fastify: FastifyInstance,
  sql: postgres.Sql,
  webhookSecret?: string
) {
  fastify.post<{ Body: GitHubWebhookEvent }>(
    '/ingest/github',
    {
      config: {
        rawBody: true,
      },
    },
    async (request, reply) => {
      // Verify webhook signature if secret is configured
      if (webhookSecret) {
        const signature = request.headers['x-hub-signature-256'];
        if (!signature || typeof signature !== 'string') {
          reply.code(400);
          return { error: 'Missing x-hub-signature-256 header' };
        }

        const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
        if (!rawBody) {
          reply.code(400);
          return { error: 'Raw body not available for signature verification' };
        }

        const expectedSignature =
          'sha256=' + crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

        if (signature !== expectedSignature) {
          fastify.log.error('GitHub signature verification failed');
          reply.code(401);
          return { error: 'Invalid signature' };
        }
      }

      const event = request.body;
      const eventType = request.headers['x-github-event'];

      // Only process specific event types
      const shouldProcess =
        (eventType === 'workflow_run' &&
          event.workflow_run?.conclusion === 'failure') ||
        (eventType === 'dependabot_alert' && event.action === 'created') ||
        (eventType === 'code_scanning_alert' && event.action === 'created');

      if (!shouldProcess) {
        return { success: true, message: 'Event ignored' };
      }

      try {
        const providerEvent = normalizeGitHubEvent(event, String(eventType));
        const projectId = await getOrCreateProject(sql, 'github-default');

        await sql`
          INSERT INTO events (
            project_id, type, source, message, raw_data, severity, created_at
          ) VALUES (
            ${projectId},
            ${providerEvent.type},
            ${providerEvent.source},
            ${providerEvent.message},
            ${JSON.stringify(providerEvent.raw_data)},
            ${providerEvent.severity},
            NOW()
          )
        `;

        fastify.log.info(`GitHub event processed: ${eventType}`);

        return {
          success: true,
          message: `Processed GitHub event: ${eventType}`,
        };
      } catch (error) {
        fastify.log.error({ error }, 'Failed to process GitHub webhook');
        reply.code(500);
        return { success: false, message: 'Failed to process webhook' };
      }
    }
  );
}

function normalizeGitHubEvent(event: GitHubWebhookEvent, eventType: string): ProviderEvent {
  let message = 'GitHub event';
  let severity: ProviderEvent['severity'] = 'medium';

  switch (eventType) {
    case 'workflow_run': {
      const workflowName = event.workflow_run?.name || 'Unknown workflow';
      message = `Workflow failed: ${workflowName}`;
      severity = 'high';
      break;
    }

    case 'dependabot_alert': {
      const alertNumber = event.alert?.number || 'Unknown';
      message = `New Dependabot alert #${alertNumber}`;
      severity = 'medium';
      break;
    }

    case 'code_scanning_alert': {
      const alertNumber = event.alert?.number || 'Unknown';
      message = `New code scanning alert #${alertNumber}`;
      severity = 'high';
      break;
    }

    default:
      message = `GitHub event: ${eventType}`;
  }

  return {
    source: 'github',
    type: 'error',
    message,
    severity,
    raw_data: {
      event_type: eventType,
      action: event.action,
      ...event,
    },
  };
}

async function getOrCreateProject(sql: postgres.Sql, name: string): Promise<string> {
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
