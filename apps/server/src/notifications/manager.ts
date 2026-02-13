import type { Database } from '../db/index.js';
import type { Incident } from '@scanwarp/core';
import {
  createChannel,
  createResolutionChannel,
  type NotificationChannel,
  type NotificationPayload,
} from './channels.js';

export class NotificationManager {
  constructor(private db: Database) {}

  async notify(
    incident: Incident,
    providerContext?: { isProviderIssue: boolean; affectedProviders: string[] }
  ): Promise<void> {
    // Get enabled channels for this project
    const rows = await this.db.getEnabledChannels(incident.project_id);
    const channels: NotificationChannel[] = rows.map((r) => ({
      id: r.id,
      project_id: r.project_id,
      type: r.type as 'discord' | 'slack',
      webhook_url: r.webhook_url,
      enabled: r.enabled,
      created_at: r.created_at,
    }));

    if (channels.length === 0) {
      return;
    }

    // Check severity and decide when to send
    const shouldSendNow = await this.shouldSendNotification(
      incident.severity
    );

    if (!shouldSendNow) {
      console.log(
        `Delaying notification for ${incident.severity} incident ${incident.id}`
      );
      return;
    }

    // Get correlated events
    const correlatedEvents = await this.getCorrelatedEvents(incident);

    const payload: NotificationPayload = {
      incident,
      correlatedEvents,
      isProviderIssue: providerContext?.isProviderIssue,
      affectedProviders: providerContext?.affectedProviders,
    };

    // Send to all channels with rate limiting
    for (const channel of channels) {
      try {
        // Check rate limits
        const canSend = await this.checkRateLimit(channel.id, incident.id);
        if (!canSend) {
          console.log(
            `Rate limit exceeded for channel ${channel.id}, skipping notification`
          );
          continue;
        }

        // Create and send notification
        const notificationChannel = createChannel(channel);
        await notificationChannel.send(payload);

        // Log the notification
        await this.db.logNotification(channel.id, incident.id);

        console.log(
          `Sent ${incident.severity} notification to ${channel.type} channel ${channel.id}`
        );
      } catch (error) {
        console.error(
          `Failed to send notification to channel ${channel.id}:`,
          error
        );
      }
    }
  }

  async notifyResolution(incident: Incident): Promise<void> {
    // Get enabled channels for this project
    const rows = await this.db.getEnabledChannels(incident.project_id);
    const channels: NotificationChannel[] = rows.map((r) => ({
      id: r.id,
      project_id: r.project_id,
      type: r.type as 'discord' | 'slack',
      webhook_url: r.webhook_url,
      enabled: r.enabled,
      created_at: r.created_at,
    }));

    if (channels.length === 0) {
      return;
    }

    const payload: NotificationPayload = {
      incident,
    };

    // Send resolution notification to all channels
    for (const channel of channels) {
      try {
        const resolutionChannel = createResolutionChannel(channel);
        await resolutionChannel.send(payload);

        console.log(
          `Sent resolution notification to ${channel.type} channel ${channel.id}`
        );
      } catch (error) {
        console.error(
          `Failed to send resolution notification to channel ${channel.id}:`,
          error
        );
      }
    }
  }

  private async getCorrelatedEvents(incident: Incident): Promise<
    Array<{
      type: string;
      source: string;
      message: string;
      created_at: Date;
    }>
  > {
    const eventIds = Array.isArray(incident.events) ? incident.events : [];

    if (eventIds.length === 0) {
      return [];
    }

    return await this.db.getCorrelatedEvents(eventIds);
  }

  private async shouldSendNotification(severity: string): Promise<boolean> {
    // Critical: send immediately
    if (severity === 'critical') {
      return true;
    }

    // Warning: wait 5 minutes to see if it resolves itself
    // For now, we'll send immediately, but this could be enhanced
    // with a background job that checks if warnings persist
    if (severity === 'warning') {
      return true; // TODO: Implement delayed notification logic
    }

    // Info: could be part of daily digest
    // For now, we'll send immediately
    if (severity === 'info') {
      return true; // TODO: Implement digest logic
    }

    return true;
  }

  private async checkRateLimit(
    channelId: string,
    incidentId: string
  ): Promise<boolean> {
    // Rule 1: Max 1 notification per incident per channel
    const alreadySent = await this.db.hasNotificationForIncident(channelId, incidentId);
    if (alreadySent) {
      return false;
    }

    // Rule 2: Max 10 notifications per hour per channel
    const recentCount = await this.db.getRecentNotificationCount(channelId);
    if (recentCount >= 10) {
      return false;
    }

    return true;
  }

  // API methods for channel management
  async createChannel(
    projectId: string,
    type: 'discord' | 'slack',
    webhookUrl: string
  ): Promise<NotificationChannel> {
    const row = await this.db.createChannel(projectId, type, webhookUrl);
    return {
      id: row.id,
      project_id: row.project_id,
      type: row.type as 'discord' | 'slack',
      webhook_url: row.webhook_url,
      enabled: row.enabled,
      created_at: row.created_at,
    };
  }

  async getChannels(projectId: string): Promise<NotificationChannel[]> {
    const rows = await this.db.getChannels(projectId);
    return rows.map((r) => ({
      id: r.id,
      project_id: r.project_id,
      type: r.type as 'discord' | 'slack',
      webhook_url: r.webhook_url,
      enabled: r.enabled,
      created_at: r.created_at,
    }));
  }

  async deleteChannel(channelId: string): Promise<void> {
    await this.db.deleteChannel(channelId);
  }

  async toggleChannel(channelId: string, enabled: boolean): Promise<void> {
    await this.db.toggleChannel(channelId, enabled);
  }

  async testChannel(channelId: string): Promise<void> {
    const channel = await this.db.getChannelById(channelId);

    if (!channel) {
      throw new Error('Channel not found');
    }

    // Create a test incident
    const testIncident: Incident = {
      id: 'test-incident',
      project_id: channel.project_id,
      events: [],
      status: 'open',
      severity: 'info',
      diagnosis_text: 'This is a test notification from ScanWarp.',
      diagnosis_fix:
        'No action needed. This is just a test to verify your notification channel is working correctly.',
      fix_prompt: 'This is a test notification. Your channel is configured correctly!',
      created_at: new Date(),
    };

    const payload: NotificationPayload = {
      incident: testIncident,
    };

    const notificationChannel = createChannel({
      id: channel.id,
      project_id: channel.project_id,
      type: channel.type as 'discord' | 'slack',
      webhook_url: channel.webhook_url,
      enabled: channel.enabled,
      created_at: channel.created_at,
    });
    await notificationChannel.send(payload);
  }
}
