import type { Database } from '../db/index.js';
import type { Event } from '@scanwarp/core';

interface AnomalyResult {
  isAnomaly: boolean;
  reason?: string;
  shouldDiagnose: boolean;
}

export class AnomalyDetector {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async analyzeEvent(event: Event): Promise<AnomalyResult> {
    // Check if this is a new type of error (never seen before for this monitor)
    if (event.type === 'error' || event.type === 'down') {
      const isNewError = await this.isNewErrorType(event);
      if (isNewError) {
        console.log(`New error type detected for monitor ${event.monitor_id}: ${event.message}`);
        return {
          isAnomaly: true,
          reason: 'New error type never seen before',
          shouldDiagnose: true,
        };
      }
    }

    // Check if error rate has spiked 3x above baseline
    if (event.monitor_id) {
      const hasErrorSpike = await this.hasErrorRateSpike(event.monitor_id);
      if (hasErrorSpike) {
        console.log(`Error rate spike detected for monitor ${event.monitor_id}`);
        return {
          isAnomaly: true,
          reason: 'Error rate is 3x above baseline',
          shouldDiagnose: true,
        };
      }
    }

    // Not an anomaly, store quietly
    return {
      isAnomaly: false,
      shouldDiagnose: false,
    };
  }

  private async isNewErrorType(event: Event): Promise<boolean> {
    if (!event.monitor_id) {
      return false;
    }

    // Look for similar error messages in the past
    const count = await this.db.getSimilarErrorCount(event.monitor_id, event.id, this.extractErrorPattern(event.message));

    return count === 0;
  }

  private async hasErrorRateSpike(monitorId: string): Promise<boolean> {
    // Get error count in the last hour
    const recentErrorCount = await this.db.getRecentErrorCount(monitorId);

    // Get baseline error count (average per hour over last 7 days, excluding last hour)
    const baselineErrorRate = await this.db.getBaselineErrorRate(monitorId);

    // If we have fewer than 3 baseline errors, don't flag as spike
    if (baselineErrorRate < 1) {
      return false;
    }

    // Check if recent error count is 3x higher than baseline
    return recentErrorCount > baselineErrorRate * 3;
  }

  private extractErrorPattern(message: string): string {
    // Extract the core error pattern, removing specific IDs, timestamps, etc.
    // This is a simple version - could be made more sophisticated
    return message
      .replace(/\d+/g, '') // Remove numbers
      .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '') // Remove UUIDs
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '') // Remove dates
      .substring(0, 50); // Take first 50 chars as pattern
  }

  async markForDiagnosis(eventId: string, reason: string) {
    // Update the event to flag it for diagnosis
    await this.db.flagEventForDiagnosis(eventId, reason);

    console.log(`Event ${eventId} flagged for diagnosis: ${reason}`);
  }
}
