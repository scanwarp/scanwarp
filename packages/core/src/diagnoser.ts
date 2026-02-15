import Anthropic from '@anthropic-ai/sdk';
import type { Event, Monitor, DiagnosisResult, TraceSpan } from './types.js';

interface DiagnoserConfig {
  apiKey: string;
  model?: string;
}

interface ProviderStatusContext {
  provider: string;
  displayName: string;
  status: string;
  description: string | null;
}

interface DiagnosisContext {
  events: Event[];
  monitor?: Monitor;
  recentHistory?: Array<{
    timestamp: Date;
    status: string;
    message: string;
  }>;
  traces?: TraceSpan[];
  providerStatuses?: ProviderStatusContext[];
}

export { type DiagnosisContext };

export class Diagnoser {
  private client: Anthropic;
  private model: string;

  constructor(config: DiagnoserConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
    this.model = config.model || 'claude-sonnet-4-20250514';
  }

  async diagnose(context: DiagnosisContext): Promise<DiagnosisResult> {
    const prompt = this.buildPrompt(context);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2000,
      temperature: 0.3,
      system: this.getSystemPrompt(context),
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    return this.parseResponse(content.text);
  }

  private getSystemPrompt(context: DiagnosisContext): string {
    const hasTraces = context.traces && context.traces.length > 0;
    const hasProviderIssues = context.providerStatuses && context.providerStatuses.length > 0;

    let prompt = `You are a senior engineering mentor helping developers who built their application using AI coding tools like Cursor or Claude Code. These developers may not have deep infrastructure knowledge or be familiar with reading stack traces.

Your job is to:
1. Explain what went wrong in plain, conversational English (no jargon)
2. Explain WHY it happened in a way a non-expert can understand
3. Provide a clear, actionable fix in plain language
4. Write a ready-to-paste prompt they can give to their AI coding assistant to fix the issue${hasTraces ? '\n5. Identify the specific span (operation) that is the bottleneck or root cause' : ''}

Think of yourself as a patient mentor who's explaining a production issue to someone smart but new to production systems.

IMPORTANT RULES:
- NO technical jargon without explanation
- NO raw stack traces in your response
- Use analogies when helpful
- Be encouraging, not condescending
- Focus on "what to do" not "what you did wrong"${hasTraces ? '\n- When trace data is available, use it to pinpoint the EXACT operation that failed or is slow' : ''}`;

    if (hasProviderIssues) {
      prompt += `

PROVIDER OUTAGE RULES (CRITICAL — follow these when provider status data shows a non-operational provider):
- If the issue correlates with a provider that is currently experiencing an outage or degraded performance, clearly state that the issue is CAUSED BY the provider outage, NOT a bug in the user's code
- The root_cause MUST mention the provider by name and their current status (e.g. "This is caused by a Vercel outage, not a bug in your code")
- The suggested_fix should focus on: (1) waiting for the provider to recover, (2) checking the provider's status page, and (3) any temporary workarounds
- Do NOT suggest code fixes for issues caused by provider outages — it's not the user's fault
- The fix_prompt should suggest adding resilience improvements (retry logic, fallbacks, circuit breakers) as an OPTIONAL improvement, not as a bug fix`;
    }

    prompt += `

Respond in this exact JSON format:
{
  "root_cause": "1-2 sentence plain English explanation of what broke",
  "severity": "critical|warning|info",
  "suggested_fix": "Plain English explanation of how to fix it (2-4 sentences)",
  "fix_prompt": "A complete, copy-pasteable prompt for Cursor/Claude Code that will fix this issue"${hasTraces ? `,
  "bottleneck_span": "name of the span that is the root cause (e.g. 'stripe: payment_intents.create' or 'pg: SELECT * FROM users')",
  "trace_id": "the trace_id of the most relevant trace"` : ''}
}

The fix_prompt should be detailed and include:
- What file(s) to modify
- What specific changes to make
- Any environment variables or config needed
- How to test the fix

Make the fix_prompt actionable enough that an AI coding assistant can implement it without asking follow-up questions.`;

    return prompt;
  }

  private buildPrompt(context: DiagnosisContext): string {
    const { events, monitor, recentHistory, traces, providerStatuses } = context;

    let prompt = '## Production Issue Detected\n\n';

    // Provider status section — show this first so the AI sees it immediately
    if (providerStatuses && providerStatuses.length > 0) {
      prompt += '**⚠️ Provider Status (current):**\n';
      for (const ps of providerStatuses) {
        const statusLabel = ps.status === 'operational' ? '✅ operational' : `🔴 ${ps.status}`;
        const detail = ps.description ? ` — ${ps.description}` : '';
        prompt += `- ${ps.displayName}: ${statusLabel}${detail}\n`;
      }
      prompt += '\nNote: One or more infrastructure providers are experiencing issues. Consider whether this incident is caused by the provider outage rather than a code bug.\n\n';
    }

    // Add monitor context if available
    if (monitor) {
      prompt += `**Service:** ${monitor.url}\n`;
      prompt += `**Current Status:** ${monitor.status}\n\n`;
    }

    // Add event information
    prompt += `**Recent Events:**\n`;
    for (const event of events) {
      prompt += `- [${event.type.toUpperCase()}] ${event.message}\n`;
      prompt += `  Severity: ${event.severity} | Time: ${event.created_at.toISOString()}\n`;

      if (event.raw_data) {
        const sanitizedData = this.sanitizeRawData(event.raw_data);
        if (Object.keys(sanitizedData).length > 0) {
          prompt += `  Details: ${JSON.stringify(sanitizedData, null, 2)}\n`;
        }
      }
      prompt += '\n';
    }

    // Add trace waterfall if available
    if (traces && traces.length > 0) {
      const waterfall = buildTraceWaterfall(traces);
      if (waterfall) {
        prompt += `\n**Request Traces (from OpenTelemetry instrumentation):**\n`;
        prompt += `These traces show the exact sequence of operations your app performed during the failing request(s).\n\n`;
        prompt += waterfall;
        prompt += '\n';
      }
    }

    // Add recent history if available
    if (recentHistory && recentHistory.length > 0) {
      prompt += `\n**Recent History (last 24 hours):**\n`;
      for (const item of recentHistory.slice(0, 10)) {
        prompt += `- ${item.timestamp.toISOString()}: ${item.status} - ${item.message}\n`;
      }
      prompt += '\n';
    }

    prompt += '\nPlease diagnose this issue and provide a fix.';

    return prompt;
  }

  private sanitizeRawData(data: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    // Include relevant fields, exclude sensitive or verbose ones
    const relevantFields = [
      'statusCode',
      'responseTime',
      'error',
      'url',
      'method',
      'level',
      'message',
      'type',
      'source',
      'trace_id',
      'span_id',
      'service_name',
      'operation_name',
      'duration_ms',
      'status_message',
      'db_system',
    ];

    for (const field of relevantFields) {
      if (field in data) {
        const val = data[field];
        // Truncate string values to prevent excessive data in prompt
        sanitized[field] = typeof val === 'string' ? val.slice(0, 500) : val;
      }
    }

    return sanitized;
  }

  private parseResponse(text: string): DiagnosisResult {
    try {
      // Try to extract JSON from the response (non-greedy to avoid grabbing too much)
      const jsonMatch = text.match(/\{[\s\S]*?\}(?=[^}]*$)/) || text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      // Find balanced braces for proper JSON extraction
      const startIdx = text.indexOf('{');
      if (startIdx === -1) throw new Error('No JSON found in response');
      let depth = 0;
      let endIdx = -1;
      for (let i = startIdx; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
        if (depth === 0) { endIdx = i; break; }
      }
      if (endIdx === -1) throw new Error('Unbalanced JSON in response');

      const parsed = JSON.parse(text.slice(startIdx, endIdx + 1));

      return {
        root_cause: parsed.root_cause || 'Unable to determine root cause',
        severity: this.normalizeSeverity(parsed.severity),
        suggested_fix: parsed.suggested_fix || 'No fix suggested',
        fix_prompt: parsed.fix_prompt || 'No fix prompt provided',
        bottleneck_span: parsed.bottleneck_span || undefined,
        trace_id: parsed.trace_id || undefined,
      };
    } catch (error) {
      // Fallback if parsing fails
      console.error('Failed to parse diagnosis response:', error);
      return {
        root_cause: 'Failed to parse diagnosis from AI response',
        severity: 'warning',
        suggested_fix: text.substring(0, 500),
        fix_prompt:
          'Unable to generate fix prompt. Please review the raw diagnosis and consult your AI coding assistant.',
      };
    }
  }

  private normalizeSeverity(severity: string): 'critical' | 'warning' | 'info' {
    const normalized = severity.toLowerCase();
    if (normalized === 'critical') return 'critical';
    if (normalized === 'warning') return 'warning';
    return 'info';
  }
}

/**
 * Build a human-readable waterfall view of traces, grouped by trace_id.
 * Each trace shows the root span and its children as an indented tree.
 */
function buildTraceWaterfall(spans: TraceSpan[]): string {
  // Group spans by trace_id
  const traceMap = new Map<string, TraceSpan[]>();
  for (const span of spans) {
    const group = traceMap.get(span.trace_id) || [];
    group.push(span);
    traceMap.set(span.trace_id, group);
  }

  const sections: string[] = [];

  for (const [traceId, traceSpans] of traceMap) {
    // Sort by start_time
    traceSpans.sort((a, b) => a.start_time - b.start_time);

    // Build a parent → children index
    const childrenMap = new Map<string | null, TraceSpan[]>();
    for (const span of traceSpans) {
      const parentKey = span.parent_span_id;
      const siblings = childrenMap.get(parentKey) || [];
      siblings.push(span);
      childrenMap.set(parentKey, siblings);
    }

    // Find root spans (no parent or parent not in this trace)
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

    // Limit to 5 traces to keep prompt size reasonable
    if (sections.length >= 5) break;
  }

  return sections.join('\n');
}

/**
 * Render a single span and its children as an indented tree.
 */
function renderSpanTree(
  span: TraceSpan,
  childrenMap: Map<string | null, TraceSpan[]>,
  prefix: string,
  isLast: boolean,
): string {
  const status = formatSpanStatus(span);
  const label = formatSpanLabel(span);
  const connector = prefix === '' ? '' : isLast ? '└─ ' : '├─ ';

  let line = `${prefix}${connector}${label} (${span.duration_ms}ms) ${status}\n`;

  // Add key attributes on a sub-line for context
  const detail = formatSpanDetail(span);
  if (detail) {
    const detailPrefix = prefix === '' ? '   ' : prefix + (isLast ? '   ' : '│  ');
    line += `${detailPrefix}${detail}\n`;
  }

  // Render children
  const children = childrenMap.get(span.span_id) || [];
  children.sort((a, b) => a.start_time - b.start_time);

  const childPrefix = prefix === '' ? '' : prefix + (isLast ? '   ' : '│  ');

  for (let i = 0; i < children.length; i++) {
    line += renderSpanTree(children[i], childrenMap, childPrefix, i === children.length - 1);
  }

  return line;
}

function formatSpanLabel(span: TraceSpan): string {
  const attrs = span.attributes;

  // Database spans: show db.system + operation
  if (attrs['db.system']) {
    const stmt = attrs['db.statement'];
    if (typeof stmt === 'string') {
      const truncated = stmt.length > 80 ? stmt.substring(0, 80) + '...' : stmt;
      return `${attrs['db.system']}: ${truncated}`;
    }
    return `${attrs['db.system']}: ${span.operation_name}`;
  }

  // HTTP spans: show method + route/target
  const method = attrs['http.method'] || attrs['http.request.method'];
  const route = attrs['http.route'] || attrs['http.target'] || attrs['url.path'];
  if (method && route) {
    return `${method} ${route}`;
  }

  return span.operation_name;
}

function formatSpanStatus(span: TraceSpan): string {
  if (span.status_code === 'ERROR') {
    const msg = span.status_message || 'error';
    return `✗ ${msg}`;
  }
  if (span.status_code === 'OK') {
    return '✓';
  }
  // UNSET — infer from http.status_code if available
  const httpStatus = span.attributes['http.status_code'] || span.attributes['http.response.status_code'];
  if (typeof httpStatus === 'number' && httpStatus >= 400) {
    return `✗ HTTP ${httpStatus}`;
  }
  return '✓';
}

function formatSpanDetail(span: TraceSpan): string {
  const parts: string[] = [];
  const attrs = span.attributes;

  // Error message from span events
  if (span.status_code === 'ERROR') {
    const exceptionEvent = span.events.find((e) => e.name === 'exception');
    if (exceptionEvent?.attributes) {
      const msg = exceptionEvent.attributes['exception.message'];
      if (typeof msg === 'string') {
        parts.push(`error: ${msg.length > 120 ? msg.substring(0, 120) + '...' : msg}`);
      }
    }
  }

  // HTTP status
  const httpStatus = attrs['http.status_code'] || attrs['http.response.status_code'];
  if (httpStatus) {
    parts.push(`status: ${httpStatus}`);
  }

  // DB statement (if not already in label, show here for children)
  if (attrs['db.statement'] && !attrs['db.system']) {
    const stmt = String(attrs['db.statement']);
    parts.push(stmt.length > 80 ? stmt.substring(0, 80) + '...' : stmt);
  }

  return parts.join(' | ');
}
