import type { ScanWarpAPI, SpanRow } from './api.js';

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

    // Trace data
    try {
      const spans = await api.getIncidentTraces(incidentId);
      if (spans.length > 0) {
        output += `TRACE DATA:\n`;
        output += buildTraceWaterfall(spans);
        output += `\n`;
      }
    } catch {
      // Trace data is optional — don't fail the whole response
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

export async function getRecentTraces(
  api: ScanWarpAPI,
  projectId: string,
  options: {
    limit?: number;
    status?: 'error' | 'ok';
  } = {}
): Promise<string> {
  try {
    const traces = await api.getRecentTraces({
      projectId,
      limit: options.limit || 10,
      status: options.status,
    });

    if (traces.length === 0) {
      if (options.status === 'error') {
        return 'No traces with errors found. Your requests are completing successfully!';
      }
      return 'No traces found. Make sure @scanwarp/instrument is configured and your app is receiving traffic.';
    }

    let output = `Found ${traces.length} recent trace${traces.length !== 1 ? 's' : ''}`;
    if (options.status) {
      output += ` (filtered: ${options.status})`;
    }
    output += ':\n\n';

    for (const trace of traces) {
      const root = trace.root_span;
      const statusIcon = trace.has_errors ? '✗' : '✓';
      const time = new Date(Number(root.start_time)).toISOString();

      // Format the root span label
      const label = formatSpanLabel(root);

      output += `${statusIcon} ${label} (${root.duration_ms}ms)\n`;
      output += `   Trace: ${trace.trace_id}\n`;
      output += `   Service: ${root.service_name}\n`;
      output += `   Spans: ${trace.span_count} | Max duration: ${trace.max_duration_ms}ms\n`;
      output += `   Time: ${time}\n`;

      if (trace.has_errors) {
        output += `   ⚠ Contains errors\n`;
      }

      output += '\n';
    }

    output += 'Use get_trace_detail with a trace_id to see the full request waterfall.';

    return output;
  } catch (error) {
    if (error instanceof Error) {
      return `❌ Error fetching traces: ${error.message}`;
    }
    return `❌ Error fetching traces`;
  }
}

export async function getTraceDetail(
  api: ScanWarpAPI,
  traceId: string
): Promise<string> {
  try {
    const spans = await api.getTraceDetail(traceId);

    if (spans.length === 0) {
      return `No spans found for trace ${traceId}. The trace may have expired or the ID may be incorrect.`;
    }

    const root = spans.find((s) => !s.parent_span_id);
    const hasErrors = spans.some((s) => s.status_code === 'ERROR');
    const totalDuration = root?.duration_ms || Math.max(...spans.map((s) => s.duration_ms));

    let output = `Trace ${traceId}\n`;
    output += `${'─'.repeat(50)}\n`;
    output += `Service: ${root?.service_name || spans[0].service_name}\n`;
    output += `Total duration: ${totalDuration}ms\n`;
    output += `Spans: ${spans.length}\n`;
    output += `Status: ${hasErrors ? '✗ Has errors' : '✓ OK'}\n\n`;

    output += `REQUEST WATERFALL:\n`;
    output += buildTraceWaterfall(spans);

    // List error spans explicitly
    const errorSpans = spans.filter((s) => s.status_code === 'ERROR');
    if (errorSpans.length > 0) {
      output += `\nERROR SPANS (${errorSpans.length}):\n`;
      for (const span of errorSpans) {
        output += `  ✗ ${formatSpanLabel(span)} (${span.duration_ms}ms)\n`;
        if (span.status_message) {
          output += `    Message: ${span.status_message}\n`;
        }
        // Check for exception events
        const exceptionEvent = span.events.find((e) => e.name === 'exception');
        if (exceptionEvent?.attributes) {
          const msg = exceptionEvent.attributes['exception.message'];
          if (typeof msg === 'string') {
            output += `    Exception: ${msg.length > 200 ? msg.substring(0, 200) + '...' : msg}\n`;
          }
        }
      }
    }

    // Find slowest spans
    const sortedByDuration = [...spans].sort((a, b) => b.duration_ms - a.duration_ms);
    const slowest = sortedByDuration.slice(0, 3);

    output += `\nSLOWEST OPERATIONS:\n`;
    for (const span of slowest) {
      const pct = totalDuration > 0 ? Math.round((span.duration_ms / totalDuration) * 100) : 0;
      output += `  ${formatSpanLabel(span)}: ${span.duration_ms}ms (${pct}% of total)\n`;
    }

    return output;
  } catch (error) {
    if (error instanceof Error) {
      return `❌ Error fetching trace: ${error.message}`;
    }
    return `❌ Error fetching trace`;
  }
}

export async function getTraceForIncident(
  api: ScanWarpAPI,
  incidentId: string
): Promise<string> {
  try {
    const [incidentData, spans] = await Promise.all([
      api.getIncident(incidentId),
      api.getIncidentTraces(incidentId),
    ]);

    const { incident } = incidentData;

    let output = `Traces for Incident #${incidentId.substring(0, 8)}\n`;
    output += `${'─'.repeat(50)}\n\n`;

    // Show diagnosis summary
    if (incident.diagnosis_text) {
      output += `ROOT CAUSE: ${incident.diagnosis_text}\n\n`;
    }

    if (spans.length === 0) {
      output += 'No trace data available for this incident.\n';

      if (incident.diagnosis_fix) {
        output += `\nSUGGESTED FIX: ${incident.diagnosis_fix}\n`;
      }

      return output;
    }

    // Group spans by trace_id
    const traceIds = [...new Set(spans.map((s) => s.trace_id))];
    output += `Found ${spans.length} spans across ${traceIds.length} trace${traceIds.length !== 1 ? 's' : ''}.\n\n`;

    output += `REQUEST WATERFALL:\n`;
    output += buildTraceWaterfall(spans);

    // Highlight the bottleneck
    const errorSpans = spans.filter((s) => s.status_code === 'ERROR');
    if (errorSpans.length > 0) {
      output += `\nERROR SPANS:\n`;
      for (const span of errorSpans) {
        output += `  ✗ ${formatSpanLabel(span)} (${span.duration_ms}ms) — ${span.service_name}\n`;
        if (span.status_message) {
          output += `    ${span.status_message}\n`;
        }
      }
    }

    if (incident.diagnosis_fix) {
      output += `\nSUGGESTED FIX:\n${incident.diagnosis_fix}\n`;
    }

    if (incident.fix_prompt) {
      output += `\nFIX PROMPT (ready to use):\n${'─'.repeat(50)}\n${incident.fix_prompt}\n${'─'.repeat(50)}\n`;
    }

    return output;
  } catch (error) {
    if (error instanceof Error) {
      return `❌ Error fetching traces for incident: ${error.message}`;
    }
    return `❌ Error fetching traces for incident`;
  }
}

// ─── Trace formatting helpers ───

function formatSpanLabel(span: SpanRow): string {
  const attrs = span.attributes;

  // Database spans
  if (attrs['db.system']) {
    const stmt = attrs['db.statement'];
    if (typeof stmt === 'string') {
      const truncated = stmt.length > 80 ? stmt.substring(0, 80) + '...' : stmt;
      return `${attrs['db.system']}: ${truncated}`;
    }
    return `${attrs['db.system']}: ${span.operation_name}`;
  }

  // HTTP spans
  const method = attrs['http.method'] || attrs['http.request.method'];
  const route = attrs['http.route'] || attrs['http.target'] || attrs['url.path'];
  if (method && route) {
    return `${method} ${route}`;
  }

  return span.operation_name;
}

/**
 * Build a human-readable waterfall view from a list of spans.
 */
function buildTraceWaterfall(spans: SpanRow[]): string {
  // Group by trace_id
  const traceMap = new Map<string, SpanRow[]>();
  for (const span of spans) {
    const group = traceMap.get(span.trace_id) || [];
    group.push(span);
    traceMap.set(span.trace_id, group);
  }

  const sections: string[] = [];

  for (const [traceId, traceSpans] of traceMap) {
    traceSpans.sort((a, b) => Number(a.start_time) - Number(b.start_time));

    // Build parent → children index
    const childrenMap = new Map<string | null, SpanRow[]>();
    for (const span of traceSpans) {
      const parentKey = span.parent_span_id;
      const siblings = childrenMap.get(parentKey) || [];
      siblings.push(span);
      childrenMap.set(parentKey, siblings);
    }

    // Find root spans
    const spanIds = new Set(traceSpans.map((s) => s.span_id));
    const roots = traceSpans.filter(
      (s) => !s.parent_span_id || !spanIds.has(s.parent_span_id)
    );

    if (roots.length === 0) continue;

    let section = `\`\`\`\nTrace ${traceId}\n`;

    for (const root of roots) {
      section += renderSpanTree(root, childrenMap, '', true);
    }

    section += '```\n';
    sections.push(section);

    if (sections.length >= 5) break;
  }

  return sections.join('\n');
}

function renderSpanTree(
  span: SpanRow,
  childrenMap: Map<string | null, SpanRow[]>,
  prefix: string,
  isLast: boolean,
): string {
  const status = span.status_code === 'ERROR'
    ? `✗ ${span.status_message || 'error'}`
    : '✓';
  const label = formatSpanLabel(span);
  const connector = prefix === '' ? '' : isLast ? '└─ ' : '├─ ';

  let line = `${prefix}${connector}${label} (${span.duration_ms}ms) ${status}\n`;

  // Render children
  const children = childrenMap.get(span.span_id) || [];
  children.sort((a, b) => Number(a.start_time) - Number(b.start_time));

  const childPrefix = prefix === '' ? '' : prefix + (isLast ? '   ' : '│  ');

  for (let i = 0; i < children.length; i++) {
    line += renderSpanTree(children[i], childrenMap, childPrefix, i === children.length - 1);
  }

  return line;
}
