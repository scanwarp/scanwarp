import type { FastifyInstance, FastifyRequest } from 'fastify';
import type postgres from 'postgres';
import Stripe from 'stripe';
import type { StripeWebhookEvent, ProviderEvent } from '@scanwarp/core';

const ERROR_EVENTS = [
  'payment_intent.payment_failed',
  'charge.failed',
  'checkout.session.expired',
  'invoice.payment_failed',
  'customer.subscription.deleted',
];

export async function registerStripeWebhook(
  fastify: FastifyInstance,
  sql: postgres.Sql,
  webhookSecret?: string
) {
  fastify.post<{ Body: StripeWebhookEvent }>(
    '/ingest/stripe',
    {
      config: {
        // Need raw body for signature verification
        rawBody: true,
      },
    },
    async (request, reply) => {
      let event: StripeWebhookEvent = request.body;

      // Verify webhook signature if secret is configured
      if (webhookSecret) {
        try {
          const signature = request.headers['stripe-signature'];
          if (!signature) {
            reply.code(400);
            return { error: 'Missing stripe-signature header' };
          }

          // Get raw body for verification
          const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
          if (!rawBody) {
            reply.code(400);
            return { error: 'Raw body not available for signature verification' };
          }

          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
            apiVersion: '2026-01-28.clover',
          });

          event = stripe.webhooks.constructEvent(
            rawBody,
            signature,
            webhookSecret
          ) as unknown as StripeWebhookEvent;
        } catch (err) {
          fastify.log.error({ err }, 'Stripe signature verification failed');
          reply.code(400);
          return { error: 'Invalid signature' };
        }
      }

      // Only process error events
      if (!ERROR_EVENTS.includes(event.type)) {
        return { success: true, message: 'Event ignored (not an error event)' };
      }

      try {
        const providerEvent = normalizeStripeEvent(event);
        const projectId = await getOrCreateProject(sql, 'stripe-default');

        // Create event in database
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

        fastify.log.info(`Stripe event processed: ${event.type}`);

        return {
          success: true,
          message: `Processed Stripe event: ${event.type}`,
        };
      } catch (error) {
        fastify.log.error({ error }, 'Failed to process Stripe webhook');
        reply.code(500);
        return { success: false, message: 'Failed to process webhook' };
      }
    }
  );
}

function normalizeStripeEvent(event: StripeWebhookEvent): ProviderEvent {
  const obj = event.data.object;

  let message = 'Stripe event';
  let severity: ProviderEvent['severity'] = 'medium';

  switch (event.type) {
    case 'payment_intent.payment_failed': {
      const amount = obj.amount ? `$${((obj.amount as number) / 100).toFixed(2)}` : '';
      const reason = obj.last_payment_error
        ? String((obj.last_payment_error as { message?: string }).message)
        : 'Unknown reason';
      message = `Payment failed for ${amount} - ${reason}`;
      severity = 'high';
      break;
    }

    case 'charge.failed': {
      const amount = obj.amount ? `$${((obj.amount as number) / 100).toFixed(2)}` : '';
      const failureMessage = obj.failure_message ? String(obj.failure_message) : 'Card declined';
      message = `Charge failed for ${amount} - ${failureMessage}`;
      severity = 'high';
      break;
    }

    case 'checkout.session.expired': {
      const customerEmail = obj.customer_email ? ` (${obj.customer_email})` : '';
      message = `Checkout session expired${customerEmail}`;
      severity = 'medium';
      break;
    }

    case 'invoice.payment_failed': {
      const amount = obj.amount_due ? `$${((obj.amount_due as number) / 100).toFixed(2)}` : '';
      message = `Invoice payment failed for ${amount}`;
      severity = 'high';
      break;
    }

    case 'customer.subscription.deleted': {
      const customerId = obj.customer ? String(obj.customer) : 'Unknown';
      message = `Subscription deleted for customer ${customerId}`;
      severity = 'medium';
      break;
    }

    default:
      message = `Stripe event: ${event.type}`;
  }

  return {
    source: 'stripe',
    type: 'error',
    message,
    severity,
    raw_data: {
      event_id: event.id,
      event_type: event.type,
      object: obj,
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
