import type { Event, ProviderStatus } from './types.js';

export interface CorrelationResult {
  shouldCorrelate: boolean;
  correlationGroup?: string;
  existingIncidentId?: string;
  reason?: string;
}

export class Correlator {
  /**
   * Analyzes if a new event should be correlated with existing events/incidents
   */
  async correlate(
    newEvent: Event,
    recentEvents: Event[],
    openIncidents: Array<{ id: string; events: string[]; correlation_group?: string }>,
    providerStatuses: ProviderStatus[]
  ): Promise<CorrelationResult> {
    // Rule 1: Check if this is part of a provider outage
    const providerOutage = this.checkProviderOutage(newEvent, providerStatuses);
    if (providerOutage) {
      return {
        shouldCorrelate: true,
        correlationGroup: `provider-${providerOutage.provider}`,
        reason: `${providerOutage.provider} is experiencing ${providerOutage.status}`,
      };
    }

    // Rule 2: Same URL/endpoint within 5 minutes
    const sameEndpoint = this.findSameEndpoint(newEvent, recentEvents);
    if (sameEndpoint) {
      const incident = this.findIncidentWithEvent(sameEndpoint.id, openIncidents);
      if (incident) {
        return {
          shouldCorrelate: true,
          correlationGroup: incident.correlation_group || `endpoint-${this.extractEndpoint(newEvent)}`,
          existingIncidentId: incident.id,
          reason: 'Same endpoint affected within 5 minutes',
        };
      }
    }

    // Rule 3: Stripe payment failure + server 500 on checkout endpoint within 2 minutes
    if (newEvent.source === 'stripe' || this.isCheckoutEndpoint(newEvent)) {
      const correlated = this.correlatePaymentAndCheckout(newEvent, recentEvents);
      if (correlated) {
        const incident = this.findIncidentWithEvent(correlated.id, openIncidents);
        if (incident) {
          return {
            shouldCorrelate: true,
            correlationGroup: incident.correlation_group || 'payment-checkout-failure',
            existingIncidentId: incident.id,
            reason: 'Payment failure correlated with checkout endpoint error',
          };
        }
        return {
          shouldCorrelate: true,
          correlationGroup: 'payment-checkout-failure',
          reason: 'Payment failure correlated with checkout endpoint error',
        };
      }
    }

    // Rule 4: Multiple monitors failing at once (3+ within 2 minutes)
    const multipleFailures = this.checkMultipleMonitorFailures(newEvent, recentEvents);
    if (multipleFailures.length >= 2) {
      // Check if there's already an incident for this burst
      const burstIncident = openIncidents.find((inc) =>
        inc.correlation_group?.startsWith('multi-failure-')
      );
      if (burstIncident) {
        return {
          shouldCorrelate: true,
          correlationGroup: burstIncident.correlation_group,
          existingIncidentId: burstIncident.id,
          reason: 'Part of multi-monitor failure burst',
        };
      }
      return {
        shouldCorrelate: true,
        correlationGroup: `multi-failure-${Date.now()}`,
        reason: `${multipleFailures.length + 1} monitors failing simultaneously`,
      };
    }

    // No correlation found
    return { shouldCorrelate: false };
  }

  private checkProviderOutage(
    event: Event,
    providerStatuses: ProviderStatus[]
  ): ProviderStatus | null {
    // Map event sources to provider names
    const providerMap: Record<string, string> = {
      vercel: 'vercel',
      supabase: 'supabase',
      stripe: 'stripe',
      github: 'github',
    };

    const provider = providerMap[event.source];
    if (!provider) return null;

    const status = providerStatuses.find((p) => p.provider === provider);
    if (status && (status.status === 'degraded' || status.status === 'outage')) {
      return status;
    }

    return null;
  }

  private findSameEndpoint(newEvent: Event, recentEvents: Event[]): Event | null {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const newEndpoint = this.extractEndpoint(newEvent);

    if (!newEndpoint) return null;

    return (
      recentEvents.find((event) => {
        if (event.created_at < fiveMinutesAgo) return false;
        if (event.id === newEvent.id) return false;

        const endpoint = this.extractEndpoint(event);
        return endpoint === newEndpoint;
      }) || null
    );
  }

  private extractEndpoint(event: Event): string | null {
    // Try to extract URL from monitor or raw_data
    if (event.monitor_id && event.raw_data?.url) {
      return String(event.raw_data.url);
    }

    // Try to extract from message (basic pattern matching)
    const urlMatch = event.message.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      return urlMatch[0];
    }

    // Extract path from message like "POST /api/checkout failed"
    const pathMatch = event.message.match(/\/(api|checkout|webhook|auth)\/[^\s]*/);
    if (pathMatch) {
      return pathMatch[0];
    }

    return null;
  }

  private isCheckoutEndpoint(event: Event): boolean {
    const endpoint = this.extractEndpoint(event);
    if (!endpoint) return false;

    return (
      endpoint.includes('/checkout') ||
      endpoint.includes('/payment') ||
      endpoint.includes('/stripe')
    );
  }

  private correlatePaymentAndCheckout(newEvent: Event, recentEvents: Event[]): Event | null {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

    // If this is a stripe event, look for recent checkout errors
    if (newEvent.source === 'stripe') {
      return (
        recentEvents.find((event) => {
          if (event.created_at < twoMinutesAgo) return false;
          if (event.source === 'stripe') return false;
          return this.isCheckoutEndpoint(event) && event.type === 'error';
        }) || null
      );
    }

    // If this is a checkout error, look for recent stripe failures
    if (this.isCheckoutEndpoint(newEvent) && newEvent.type === 'error') {
      return (
        recentEvents.find((event) => {
          if (event.created_at < twoMinutesAgo) return false;
          return event.source === 'stripe' && event.type === 'error';
        }) || null
      );
    }

    return null;
  }

  private checkMultipleMonitorFailures(newEvent: Event, recentEvents: Event[]): Event[] {
    if (newEvent.type !== 'down' && newEvent.type !== 'error') return [];

    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

    return recentEvents.filter((event) => {
      if (event.created_at < twoMinutesAgo) return false;
      if (event.id === newEvent.id) return false;
      if (event.type !== 'down' && event.type !== 'error') return false;

      // Must be from different monitors
      if (event.monitor_id && newEvent.monitor_id && event.monitor_id === newEvent.monitor_id) {
        return false;
      }

      return true;
    });
  }

  private findIncidentWithEvent(
    eventId: string,
    incidents: Array<{ id: string; events: string[]; correlation_group?: string }>
  ): typeof incidents[0] | null {
    return incidents.find((inc) => inc.events.includes(eventId)) || null;
  }
}
