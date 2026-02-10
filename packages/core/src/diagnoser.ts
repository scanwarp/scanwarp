import Anthropic from '@anthropic-ai/sdk';
import type { Event, Monitor, DiagnosisResult } from './types.js';

interface DiagnoserConfig {
  apiKey: string;
  model?: string;
}

interface DiagnosisContext {
  events: Event[];
  monitor?: Monitor;
  recentHistory?: Array<{
    timestamp: Date;
    status: string;
    message: string;
  }>;
}

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
      system: this.getSystemPrompt(),
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

  private getSystemPrompt(): string {
    return `You are a senior engineering mentor helping developers who built their application using AI coding tools like Cursor or Claude Code. These developers may not have deep infrastructure knowledge or be familiar with reading stack traces.

Your job is to:
1. Explain what went wrong in plain, conversational English (no jargon)
2. Explain WHY it happened in a way a non-expert can understand
3. Provide a clear, actionable fix in plain language
4. Write a ready-to-paste prompt they can give to their AI coding assistant to fix the issue

Think of yourself as a patient mentor who's explaining a production issue to someone smart but new to production systems.

IMPORTANT RULES:
- NO technical jargon without explanation
- NO raw stack traces in your response
- Use analogies when helpful
- Be encouraging, not condescending
- Focus on "what to do" not "what you did wrong"

Respond in this exact JSON format:
{
  "root_cause": "1-2 sentence plain English explanation of what broke",
  "severity": "critical|warning|info",
  "suggested_fix": "Plain English explanation of how to fix it (2-4 sentences)",
  "fix_prompt": "A complete, copy-pasteable prompt for Cursor/Claude Code that will fix this issue"
}

The fix_prompt should be detailed and include:
- What file(s) to modify
- What specific changes to make
- Any environment variables or config needed
- How to test the fix

Make the fix_prompt actionable enough that an AI coding assistant can implement it without asking follow-up questions.`;
  }

  private buildPrompt(context: DiagnosisContext): string {
    const { events, monitor, recentHistory } = context;

    let prompt = '## Production Issue Detected\n\n';

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
    ];

    for (const field of relevantFields) {
      if (field in data) {
        sanitized[field] = data[field];
      }
    }

    return sanitized;
  }

  private parseResponse(text: string): DiagnosisResult {
    try {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        root_cause: parsed.root_cause || 'Unable to determine root cause',
        severity: this.normalizeSeverity(parsed.severity),
        suggested_fix: parsed.suggested_fix || 'No fix suggested',
        fix_prompt: parsed.fix_prompt || 'No fix prompt provided',
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
