import axios from 'axios';
import type { Incident } from '@scanwarp/core';

export interface NotificationChannel {
  id: string;
  project_id: string;
  type: 'discord' | 'slack';
  webhook_url: string;
  enabled: boolean;
  created_at: Date;
}

export interface NotificationPayload {
  incident: Incident;
  correlatedEvents?: Array<{
    type: string;
    source: string;
    message: string;
    created_at: Date;
  }>;
  isProviderIssue?: boolean;
  affectedProviders?: string[];
}

export abstract class Channel {
  constructor(protected channel: NotificationChannel) {}

  abstract send(payload: NotificationPayload): Promise<void>;

  protected getSeverityEmoji(severity: string): string {
    switch (severity) {
      case 'critical':
        return '🔴';
      case 'warning':
        return '🟡';
      case 'info':
        return '🔵';
      default:
        return '⚪';
    }
  }

  protected getSeverityColor(severity: string): number {
    switch (severity) {
      case 'critical':
        return 0xff0000; // Red
      case 'warning':
        return 0xff9900; // Orange
      case 'info':
        return 0x0099ff; // Blue
      default:
        return 0x808080; // Gray
    }
  }

  protected formatTimestamp(date: Date): string {
    return new Date(date).toISOString();
  }
}

export class DiscordChannel extends Channel {
  async send(payload: NotificationPayload): Promise<void> {
    const { incident, correlatedEvents, isProviderIssue, affectedProviders } = payload;
    const emoji = this.getSeverityEmoji(incident.severity);
    const color = this.getSeverityColor(incident.severity);

    // Build fields
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

    // What happened
    if (incident.diagnosis_text) {
      fields.push({
        name: '📊 What Happened',
        value: incident.diagnosis_text.substring(0, 1024),
        inline: false,
      });
    }

    // Suggested fix
    if (incident.diagnosis_fix) {
      fields.push({
        name: '🔧 Suggested Fix',
        value: incident.diagnosis_fix.substring(0, 1024),
        inline: false,
      });
    }

    // Correlated events
    if (correlatedEvents && correlatedEvents.length > 0) {
      const eventsList = correlatedEvents
        .slice(0, 5)
        .map(
          (e) =>
            `• **${e.source}**: ${e.type} - ${e.message.substring(0, 100)}`
        )
        .join('\n');

      fields.push({
        name: '🔗 Related Events',
        value: eventsList,
        inline: false,
      });
    }

    // Severity and status
    fields.push(
      {
        name: 'Severity',
        value: incident.severity.toUpperCase(),
        inline: true,
      },
      {
        name: 'Status',
        value: incident.status.toUpperCase(),
        inline: true,
      }
    );

    // Provider issue badge
    if (isProviderIssue && affectedProviders && affectedProviders.length > 0) {
      fields.unshift({
        name: '☁️ Provider Issue',
        value: `Likely caused by: ${affectedProviders.join(', ')}`,
        inline: false,
      });
    }

    const providerBadge = isProviderIssue ? ' ☁️ Provider Issue' : '';

    const embed = {
      title: `${emoji} ScanWarp — ${incident.severity.toUpperCase()} Incident${providerBadge}`,
      description: isProviderIssue
        ? `This incident appears to be caused by a provider outage, not a bug in your code.`
        : `Incident detected in your application`,
      color,
      fields,
      footer: {
        text: incident.fix_prompt
          ? `Fix Prompt: ${incident.fix_prompt.substring(0, 200)}${incident.fix_prompt.length > 200 ? '...' : ''}`
          : 'No fix prompt available',
      },
      timestamp: this.formatTimestamp(incident.created_at),
    };

    // If fix_prompt is too long for footer, add as a field
    if (incident.fix_prompt && incident.fix_prompt.length > 200) {
      fields.push({
        name: '💬 Fix Prompt (Copy to your AI tool)',
        value: `\`\`\`\n${incident.fix_prompt.substring(0, 900)}\n\`\`\``,
        inline: false,
      });
    }

    await axios.post(this.channel.webhook_url, {
      embeds: [embed],
    });
  }
}

export class SlackChannel extends Channel {
  async send(payload: NotificationPayload): Promise<void> {
    const { incident, correlatedEvents, isProviderIssue, affectedProviders } = payload;
    const emoji = this.getSeverityEmoji(incident.severity);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [];

    const providerBadge = isProviderIssue ? ' ☁️ Provider Issue' : '';

    // Header
    blocks.push({
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} ScanWarp ${incident.severity.toUpperCase()} Incident${providerBadge}`,
      },
    });

    // Provider issue callout
    if (isProviderIssue && affectedProviders && affectedProviders.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*☁️ Provider Issue:* This incident appears to be caused by a provider outage (${affectedProviders.join(', ')}), not a bug in your code.`,
        },
      });
    }

    // What happened
    if (incident.diagnosis_text) {
      blocks.push({
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*What Happened:*\n${incident.diagnosis_text}`,
          },
        ],
      });
    }

    // Suggested fix
    if (incident.diagnosis_fix) {
      blocks.push({
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Suggested Fix:*\n${incident.diagnosis_fix}`,
          },
        ],
      });
    }

    // Impact (severity + status)
    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Severity:*\n${incident.severity.toUpperCase()}`,
        },
        {
          type: 'mrkdwn',
          text: `*Status:*\n${incident.status.toUpperCase()}`,
        },
      ],
    });

    // Correlated events
    if (correlatedEvents && correlatedEvents.length > 0) {
      const eventsList = correlatedEvents
        .slice(0, 5)
        .map((e) => `• *${e.source}*: ${e.type} - ${e.message.substring(0, 100)}`)
        .join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Related Events:*\n${eventsList}`,
        },
      });
    }

    blocks.push({
      type: 'divider',
    });

    // Fix prompt
    if (incident.fix_prompt) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Copy this to your AI coding tool:*',
        },
      });

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `\`\`\`\n${incident.fix_prompt.substring(0, 2900)}\n\`\`\``,
        },
      });
    }

    // Context (timestamp)
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Incident created: ${this.formatTimestamp(incident.created_at)}`,
        },
      ],
    });

    await axios.post(this.channel.webhook_url, {
      blocks,
    });
  }
}

export class DiscordResolutionChannel extends Channel {
  async send(payload: NotificationPayload): Promise<void> {
    const { incident } = payload;

    const duration = incident.resolved_at
      ? Math.round(
          (new Date(incident.resolved_at).getTime() -
            new Date(incident.created_at).getTime()) /
            1000 /
            60
        )
      : 0;

    const embed = {
      title: '✅ Incident Resolved',
      description: `The ${incident.severity} incident has been resolved.`,
      color: 0x00ff00, // Green
      fields: [
        {
          name: 'Duration',
          value: `${duration} minutes`,
          inline: true,
        },
        {
          name: 'Status',
          value: incident.status.toUpperCase(),
          inline: true,
        },
      ],
      timestamp: this.formatTimestamp(incident.resolved_at || new Date()),
    };

    await axios.post(this.channel.webhook_url, {
      embeds: [embed],
    });
  }
}

export class SlackResolutionChannel extends Channel {
  async send(payload: NotificationPayload): Promise<void> {
    const { incident } = payload;

    const duration = incident.resolved_at
      ? Math.round(
          (new Date(incident.resolved_at).getTime() -
            new Date(incident.created_at).getTime()) /
            1000 /
            60
        )
      : 0;

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '✅ Incident Resolved',
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Duration:*\n${duration} minutes`,
          },
          {
            type: 'mrkdwn',
            text: `*Status:*\n${incident.status.toUpperCase()}`,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Resolved at: ${this.formatTimestamp(incident.resolved_at || new Date())}`,
          },
        ],
      },
    ];

    await axios.post(this.channel.webhook_url, {
      blocks,
    });
  }
}

export function createChannel(channel: NotificationChannel): Channel {
  switch (channel.type) {
    case 'discord':
      return new DiscordChannel(channel);
    case 'slack':
      return new SlackChannel(channel);
    default:
      throw new Error(`Unsupported channel type: ${channel.type}`);
  }
}

export function createResolutionChannel(
  channel: NotificationChannel
): Channel {
  switch (channel.type) {
    case 'discord':
      return new DiscordResolutionChannel(channel);
    case 'slack':
      return new SlackResolutionChannel(channel);
    default:
      throw new Error(`Unsupported channel type: ${channel.type}`);
  }
}
