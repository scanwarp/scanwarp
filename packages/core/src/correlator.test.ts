import { describe, it, expect } from 'vitest';
import { Correlator } from './correlator.js';
import type { Event, ProviderStatus } from './types.js';

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt-1',
    project_id: 'proj-1',
    type: 'error',
    source: 'monitor',
    message: 'Something failed',
    severity: 'high',
    created_at: new Date(),
    ...overrides,
  };
}

describe('Correlator', () => {
  const correlator = new Correlator();

  describe('provider outage correlation', () => {
    it('correlates vercel source events with vercel outage', async () => {
      const event = makeEvent({ source: 'vercel' });
      const statuses: ProviderStatus[] = [
        { provider: 'vercel', status: 'outage', last_checked_at: new Date() },
      ];

      const result = await correlator.correlate(event, [], [], statuses);

      expect(result.shouldCorrelate).toBe(true);
      expect(result.correlationGroup).toBe('provider-vercel');
      expect(result.reason).toContain('vercel');
    });

    it('correlates stripe source events with stripe degraded status', async () => {
      const event = makeEvent({ source: 'stripe' });
      const statuses: ProviderStatus[] = [
        { provider: 'stripe', status: 'degraded', last_checked_at: new Date() },
      ];

      const result = await correlator.correlate(event, [], [], statuses);

      expect(result.shouldCorrelate).toBe(true);
      expect(result.correlationGroup).toBe('provider-stripe');
    });

    it('does not correlate when provider is operational', async () => {
      const event = makeEvent({ source: 'vercel' });
      const statuses: ProviderStatus[] = [
        { provider: 'vercel', status: 'operational', last_checked_at: new Date() },
      ];

      const result = await correlator.correlate(event, [], [], statuses);

      expect(result.shouldCorrelate).toBe(false);
    });

    it('does not correlate unknown source with provider statuses', async () => {
      const event = makeEvent({ source: 'monitor' });
      const statuses: ProviderStatus[] = [
        { provider: 'vercel', status: 'outage', last_checked_at: new Date() },
      ];

      const result = await correlator.correlate(event, [], [], statuses);

      expect(result.shouldCorrelate).toBe(false);
    });
  });

  describe('same endpoint correlation', () => {
    it('correlates events from the same URL within 5 minutes', async () => {
      const now = new Date();
      const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

      const existing = makeEvent({
        id: 'evt-old',
        monitor_id: 'mon-1',
        raw_data: { url: 'https://example.com/api/users' },
        created_at: twoMinutesAgo,
      });

      const incident = {
        id: 'inc-1',
        events: ['evt-old'],
        correlation_group: 'endpoint-https://example.com/api/users',
      };

      const newEvent = makeEvent({
        id: 'evt-new',
        monitor_id: 'mon-1',
        raw_data: { url: 'https://example.com/api/users' },
        created_at: now,
      });

      const result = await correlator.correlate(newEvent, [existing], [incident], []);

      expect(result.shouldCorrelate).toBe(true);
      expect(result.existingIncidentId).toBe('inc-1');
    });

    it('does not correlate events older than 5 minutes', async () => {
      const now = new Date();
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

      const existing = makeEvent({
        id: 'evt-old',
        monitor_id: 'mon-1',
        raw_data: { url: 'https://example.com/api/users' },
        created_at: tenMinutesAgo,
      });

      const newEvent = makeEvent({
        id: 'evt-new',
        monitor_id: 'mon-1',
        raw_data: { url: 'https://example.com/api/users' },
        created_at: now,
      });

      const result = await correlator.correlate(newEvent, [existing], [], []);

      expect(result.shouldCorrelate).toBe(false);
    });
  });

  describe('payment-checkout correlation', () => {
    it('correlates stripe failure with checkout endpoint error', async () => {
      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);

      const stripeEvent = makeEvent({
        id: 'evt-stripe',
        source: 'stripe',
        type: 'error',
        message: 'Payment failed',
        created_at: now,
      });

      const checkoutEvent = makeEvent({
        id: 'evt-checkout',
        source: 'monitor',
        type: 'error',
        message: 'POST /api/checkout failed with 500',
        created_at: oneMinuteAgo,
      });

      const result = await correlator.correlate(stripeEvent, [checkoutEvent], [], []);

      expect(result.shouldCorrelate).toBe(true);
      expect(result.correlationGroup).toBe('payment-checkout-failure');
    });
  });

  describe('multi-monitor failure burst', () => {
    it('correlates 3+ monitor failures within 2 minutes', async () => {
      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);

      const newEvent = makeEvent({
        id: 'evt-new',
        type: 'down',
        monitor_id: 'mon-1',
        created_at: now,
      });

      const recentEvents = [
        makeEvent({ id: 'evt-2', type: 'down', monitor_id: 'mon-2', created_at: oneMinuteAgo }),
        makeEvent({ id: 'evt-3', type: 'down', monitor_id: 'mon-3', created_at: oneMinuteAgo }),
      ];

      const result = await correlator.correlate(newEvent, recentEvents, [], []);

      expect(result.shouldCorrelate).toBe(true);
      expect(result.correlationGroup).toContain('multi-failure');
      expect(result.reason).toContain('3 monitors failing');
    });

    it('does not correlate single monitor failures from same monitor', async () => {
      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);

      const newEvent = makeEvent({
        id: 'evt-new',
        type: 'down',
        monitor_id: 'mon-1',
        created_at: now,
      });

      const recentEvents = [
        makeEvent({ id: 'evt-2', type: 'down', monitor_id: 'mon-1', created_at: oneMinuteAgo }),
      ];

      const result = await correlator.correlate(newEvent, recentEvents, [], []);

      expect(result.shouldCorrelate).toBe(false);
    });
  });

  describe('no correlation', () => {
    it('returns shouldCorrelate false when no rules match', async () => {
      const event = makeEvent();
      const result = await correlator.correlate(event, [], [], []);

      expect(result.shouldCorrelate).toBe(false);
    });
  });
});
