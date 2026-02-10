import postgres from 'postgres';
import type { Incident } from '@scanwarp/core';
import {
  createChannel,
  createResolutionChannel,
  type NotificationChannel,
  type NotificationPayload,
} from './channels.js';

export class NotificationManager {
  constructor(private sql: postgres.Sql) {}

  async notify(incident: Incident): Promise<void> {
    // Get enabled channels for this project
    const channels = await this.getEnabledChannels(incident.project_id);

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
        await this.logNotification(channel.id, incident.id);

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
    const channels = await this.getEnabledChannels(incident.project_id);

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

  private async getEnabledChannels(
    projectId: string
  ): Promise<NotificationChannel[]> {
    const rows = await this.sql<NotificationChannel[]>`
      SELECT id, project_id, type, webhook_url, enabled, created_at
      FROM notification_channels
      WHERE project_id = ${projectId}
      AND enabled = true
    `;

    return rows;
  }

  private async getCorrelatedEvents(incident: Incident): Promise<
    Array<{
      type: string;
      source: string;
      message: string;
      created_at: Date;
    }>
  > {
    // Get event IDs from the incident
    const eventIds = Array.isArray(incident.events) ? incident.events : [];

    if (eventIds.length === 0) {
      return [];
    }

    const events = await this.sql<
      Array<{
        type: string;
        source: string;
        message: string;
        created_at: Date;
      }>
    >`
      SELECT type, source, message, created_at
      FROM events
      WHERE id = ANY(${eventIds}::uuid[])
      ORDER BY created_at DESC
      LIMIT 10
    `;

    return events;
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
    const existingNotification = await this.sql`
      SELECT id
      FROM notification_log
      WHERE channel_id = ${channelId}
      AND incident_id = ${incidentId}
      LIMIT 1
    `;

    if (existingNotification.length > 0) {
      return false;
    }

    // Rule 2: Max 10 notifications per hour per channel
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentNotifications = await this.sql`
      SELECT COUNT(*) as count
      FROM notification_log
      WHERE channel_id = ${channelId}
      AND sent_at > ${oneHourAgo}
    `;

    const count = parseInt(recentNotifications[0]?.count || '0');
    if (count >= 10) {
      return false;
    }

    return true;
  }

  private async logNotification(
    channelId: string,
    incidentId: string
  ): Promise<void> {
    await this.sql`
      INSERT INTO notification_log (channel_id, incident_id)
      VALUES (${channelId}, ${incidentId})
    `;
  }

  // API methods for channel management
  async createChannel(
    projectId: string,
    type: 'discord' | 'slack',
    webhookUrl: string
  ): Promise<NotificationChannel> {
    const rows = await this.sql<NotificationChannel[]>`
      INSERT INTO notification_channels (project_id, type, webhook_url)
      VALUES (${projectId}, ${type}, ${webhookUrl})
      RETURNING id, project_id, type, webhook_url, enabled, created_at
    `;

    return rows[0];
  }

  async getChannels(projectId: string): Promise<NotificationChannel[]> {
    const rows = await this.sql<NotificationChannel[]>`
      SELECT id, project_id, type, webhook_url, enabled, created_at
      FROM notification_channels
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
    `;

    return rows;
  }

  async deleteChannel(channelId: string): Promise<void> {
    await this.sql`
      DELETE FROM notification_channels
      WHERE id = ${channelId}
    `;
  }

  async toggleChannel(channelId: string, enabled: boolean): Promise<void> {
    await this.sql`
      UPDATE notification_channels
      SET enabled = ${enabled}
      WHERE id = ${channelId}
    `;
  }

  async testChannel(channelId: string): Promise<void> {
    const channels = await this.sql<NotificationChannel[]>`
      SELECT id, project_id, type, webhook_url, enabled, created_at
      FROM notification_channels
      WHERE id = ${channelId}
    `;

    if (channels.length === 0) {
      throw new Error('Channel not found');
    }

    const channel = channels[0];

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

    const notificationChannel = createChannel(channel);
    await notificationChannel.send(payload);
  }
}
