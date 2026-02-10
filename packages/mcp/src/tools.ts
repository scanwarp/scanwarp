import type { ScanWarpAPI } from './api.js';

function formatTimeSince(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 1000 / 60);

  if (diffMins < 1) return 'just now';
  if (diffMins === 1) return '1 minute ago';
  if (diffMins < 60) return `${diffMins} minutes ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours === 1) return '1 hour ago';
  if (diffHours < 24) return `${diffHours} hours ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return '1 day ago';
  return `${diffDays} days ago`;
}

export async function getAppStatus(
  api: ScanWarpAPI,
  projectId: string
): Promise<string> {
  try {
    // Fetch all relevant data
    const [monitors, incidents, providerStatus] = await Promise.all([
      api.getMonitors(projectId),
      api.getIncidents({ projectId, status: 'open' }),
      api.getProviderStatus().catch(() => []),
    ]);

    // Check for active incidents
    if (incidents.length > 0) {
      const criticalIncidents = incidents.filter(
        (i) => i.severity === 'critical'
      );
      const warningIncidents = incidents.filter((i) => i.severity === 'warning');

      let summary = `⚠️  ${incidents.length} active incident${incidents.length > 1 ? 's' : ''}. `;

      if (criticalIncidents.length > 0) {
        const incident = criticalIncidents[0];
        const timeSince = formatTimeSince(incident.created_at);
        summary += `CRITICAL: ${incident.diagnosis_text || 'Investigating issue'} (started ${timeSince}). `;
      } else if (warningIncidents.length > 0) {
        const incident = warningIncidents[0];
        const timeSince = formatTimeSince(incident.created_at);
        summary += `${incident.diagnosis_text || 'Investigating issue'} (started ${timeSince}). `;
      }

      if (incidents.length > 1) {
        summary += `Plus ${incidents.length - 1} other incident${incidents.length - 1 > 1 ? 's' : ''}. `;
      }

      summary += `\n\nUse get_incident_detail to see full diagnosis and fix prompts.`;
      return summary;
    }

    // No incidents - check monitor health
    const downMonitors = monitors.filter((m) => m.status === 'down');

    if (downMonitors.length > 0) {
      return `⚠️  ${downMonitors.length} monitor${downMonitors.length > 1 ? 's' : ''} down: ${downMonitors.map((m) => m.url).join(', ')}. No incidents created yet.`;
    }

    // Check provider status
    const degradedProviders = providerStatus.filter(
      (p) => p.status !== 'operational'
    );
    let providerMessage = '';
    if (degradedProviders.length > 0) {
      providerMessage = ` ${degradedProviders.map((p) => `${p.provider}: ${p.status}`).join(', ')}.`;
    }

    // All good!
    return `✅ Your app is healthy. ${monitors.length} monitor${monitors.length !== 1 ? 's' : ''} all passing. No active incidents.${providerMessage || ' All providers operational.'}`;
  } catch (error) {
    if (error instanceof Error) {
      return `❌ Error fetching status: ${error.message}`;
    }
    return `❌ Error fetching status`;
  }
}

export async function getIncidents(
  api: ScanWarpAPI,
  projectId: string,
  options: {
    status?: 'open' | 'resolved';
    severity?: 'critical' | 'warning' | 'info';
    limit?: number;
  } = {}
): Promise<string> {
  try {
    const incidents = await api.getIncidents({
      projectId,
      ...options,
      limit: options.limit || 10,
    });

    if (incidents.length === 0) {
      return options.status === 'resolved'
        ? 'No resolved incidents found.'
        : 'No active incidents. Your app is running smoothly!';
    }

    let output = `Found ${incidents.length} incident${incidents.length !== 1 ? 's' : ''}:\n\n`;

    for (const incident of incidents) {
      const timeSince = formatTimeSince(incident.created_at);
      const statusEmoji =
        incident.status === 'resolved'
          ? '✅'
          : incident.severity === 'critical'
            ? '🔴'
            : incident.severity === 'warning'
              ? '🟡'
              : '🔵';

      output += `${statusEmoji} Incident #${incident.id.substring(0, 8)}\n`;
      output += `   Severity: ${incident.severity.toUpperCase()}\n`;
      output += `   Status: ${incident.status}\n`;
      output += `   Started: ${timeSince}\n`;

      if (incident.diagnosis_text) {
        output += `   Issue: ${incident.diagnosis_text}\n`;
      }

      if (incident.diagnosis_fix) {
        output += `   Fix: ${incident.diagnosis_fix.substring(0, 150)}${incident.diagnosis_fix.length > 150 ? '...' : ''}\n`;
      }

      if (incident.resolved_at) {
        const duration = Math.floor(
          (new Date(incident.resolved_at).getTime() -
            new Date(incident.created_at).getTime()) /
            1000 /
            60
        );
        output += `   Duration: ${duration} minutes\n`;
      }

      output += `\n`;
    }

    output += `Use get_incident_detail with an incident ID to see full diagnosis and fix prompts.`;

    return output;
  } catch (error) {
    if (error instanceof Error) {
      return `❌ Error fetching incidents: ${error.message}`;
    }
    return `❌ Error fetching incidents`;
  }
}

export async function getIncidentDetail(
  api: ScanWarpAPI,
  incidentId: string
): Promise<string> {
  try {
    const { incident, events } = await api.getIncident(incidentId);

    const timeSince = formatTimeSince(incident.created_at);
    const statusEmoji =
      incident.status === 'resolved'
        ? '✅'
        : incident.severity === 'critical'
          ? '🔴'
          : incident.severity === 'warning'
            ? '🟡'
            : '🔵';

    let output = `${statusEmoji} Incident #${incident.id}\n\n`;
    output += `Severity: ${incident.severity.toUpperCase()}\n`;
    output += `Status: ${incident.status}\n`;
    output += `Started: ${timeSince}\n\n`;

    if (incident.diagnosis_text) {
      output += `ROOT CAUSE:\n${incident.diagnosis_text}\n\n`;
    }

    if (incident.diagnosis_fix) {
      output += `SUGGESTED FIX:\n${incident.diagnosis_fix}\n\n`;
    }

    if (incident.fix_prompt) {
      output += `FIX PROMPT (ready to use in your AI tool):\n${'─'.repeat(50)}\n${incident.fix_prompt}\n${'─'.repeat(50)}\n\n`;
    }

    // Event timeline
    if (events.length > 0) {
      output += `EVENT TIMELINE (${events.length} events):\n`;
      const sortedEvents = [...events].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      for (const event of sortedEvents.slice(0, 10)) {
        const eventTime = formatTimeSince(event.created_at);
        output += `  • [${event.source}] ${event.type}: ${event.message.substring(0, 100)} (${eventTime})\n`;
      }

      if (events.length > 10) {
        output += `  ... and ${events.length - 10} more events\n`;
      }
      output += `\n`;
    }

    if (incident.correlation_group) {
      output += `Correlation Group: ${incident.correlation_group}\n`;
      output += `This incident groups related events that happened together.\n\n`;
    }

    if (incident.resolved_at) {
      const duration = Math.floor(
        (new Date(incident.resolved_at).getTime() -
          new Date(incident.created_at).getTime()) /
          1000 /
          60
      );
      output += `Resolved ${formatTimeSince(incident.resolved_at)} (duration: ${duration} minutes)\n`;
    }

    return output;
  } catch (error) {
    if (error instanceof Error) {
      return `❌ Error fetching incident: ${error.message}`;
    }
    return `❌ Error fetching incident`;
  }
}

export async function getEvents(
  api: ScanWarpAPI,
  projectId: string,
  options: {
    type?: string;
    source?: string;
    severity?: string;
    limit?: number;
  } = {}
): Promise<string> {
  try {
    const events = await api.getEvents({
      projectId,
      ...options,
      limit: options.limit || 20,
    });

    if (events.length === 0) {
      return 'No events found matching your criteria.';
    }

    let output = `Found ${events.length} recent event${events.length !== 1 ? 's' : ''}:\n\n`;

    for (const event of events) {
      const timeSince = formatTimeSince(event.created_at);
      const severityEmoji =
        event.severity === 'critical'
          ? '🔴'
          : event.severity === 'high'
            ? '🟠'
            : event.severity === 'medium'
              ? '🟡'
              : '🔵';

      output += `${severityEmoji} [${event.source}] ${event.type} - ${timeSince}\n`;
      output += `   ${event.message}\n`;

      if (event.raw_data && Object.keys(event.raw_data).length > 0) {
        const keys = Object.keys(event.raw_data).slice(0, 3);
        output += `   Data: ${keys.join(', ')}${Object.keys(event.raw_data).length > 3 ? ', ...' : ''}\n`;
      }

      output += `\n`;
    }

    return output;
  } catch (error) {
    if (error instanceof Error) {
      return `❌ Error fetching events: ${error.message}`;
    }
    return `❌ Error fetching events`;
  }
}

export async function resolveIncident(
  api: ScanWarpAPI,
  incidentId: string
): Promise<string> {
  try {
    await api.resolveIncident(incidentId);
    return `✅ Incident #${incidentId.substring(0, 8)} has been marked as resolved. Resolution notifications have been sent to configured channels.`;
  } catch (error) {
    if (error instanceof Error) {
      return `❌ Error resolving incident: ${error.message}`;
    }
    return `❌ Error resolving incident`;
  }
}

export async function getFixPrompt(
  api: ScanWarpAPI,
  incidentId: string
): Promise<string> {
  try {
    const { incident } = await api.getIncident(incidentId);

    if (!incident.fix_prompt) {
      return `No fix prompt available for incident #${incidentId.substring(0, 8)}. The AI diagnosis may still be in progress.`;
    }

    return incident.fix_prompt;
  } catch (error) {
    if (error instanceof Error) {
      return `❌ Error fetching fix prompt: ${error.message}`;
    }
    return `❌ Error fetching fix prompt`;
  }
}
