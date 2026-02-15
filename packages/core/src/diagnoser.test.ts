import { describe, it, expect } from 'vitest';

// We can't test the full diagnose() without an API key, but we can test
// the exported utility functions and response parsing logic.
// We test buildTraceWaterfall by importing and using it directly.

// Since buildTraceWaterfall and related functions are not exported,
// we test the Diagnoser's parseResponse and normalizeSeverity indirectly
// by creating a testable subclass.

import { Diagnoser } from './diagnoser.js';
import type { TraceSpan } from './types.js';

class TestableDiagnoser extends Diagnoser {
  public testParseResponse(text: string) {
    return (this as unknown as { parseResponse(t: string): unknown }).parseResponse(text);
  }

  public testNormalizeSeverity(severity: string) {
    return (this as unknown as { normalizeSeverity(s: string): string }).normalizeSeverity(severity);
  }

  public testSanitizeRawData(data: Record<string, unknown>) {
    return (this as unknown as { sanitizeRawData(d: Record<string, unknown>): Record<string, unknown> }).sanitizeRawData(data);
  }
}

// Use a dummy API key since we're not calling the API
const diagnoser = new TestableDiagnoser({ apiKey: 'test-key' });

describe('Diagnoser', () => {
  describe('parseResponse', () => {
    it('parses valid JSON response', () => {
      const json = JSON.stringify({
        root_cause: 'Database connection pool exhausted',
        severity: 'critical',
        suggested_fix: 'Increase pool size',
        fix_prompt: 'Open config.ts and increase DB_POOL_SIZE',
      });

      const result = diagnoser.testParseResponse(json);

      expect(result).toEqual({
        root_cause: 'Database connection pool exhausted',
        severity: 'critical',
        suggested_fix: 'Increase pool size',
        fix_prompt: 'Open config.ts and increase DB_POOL_SIZE',
        bottleneck_span: undefined,
        trace_id: undefined,
      });
    });

    it('extracts JSON from surrounding text', () => {
      const response = `Here's my analysis:

\`\`\`json
{
  "root_cause": "Memory leak in user service",
  "severity": "warning",
  "suggested_fix": "Fix the leak",
  "fix_prompt": "Fix it"
}
\`\`\`

Let me know if you need more info.`;

      const result = diagnoser.testParseResponse(response);
      expect(result).toHaveProperty('root_cause', 'Memory leak in user service');
      expect(result).toHaveProperty('severity', 'warning');
    });

    it('returns fallback for non-JSON response', () => {
      const result = diagnoser.testParseResponse('No JSON here at all');

      expect(result).toHaveProperty('root_cause', 'Failed to parse diagnosis from AI response');
      expect(result).toHaveProperty('severity', 'warning');
    });

    it('includes bottleneck_span and trace_id when present', () => {
      const json = JSON.stringify({
        root_cause: 'Slow DB query',
        severity: 'warning',
        suggested_fix: 'Add index',
        fix_prompt: 'Add index to users table',
        bottleneck_span: 'pg: SELECT * FROM users',
        trace_id: 'abc123',
      });

      const result = diagnoser.testParseResponse(json);
      expect(result).toHaveProperty('bottleneck_span', 'pg: SELECT * FROM users');
      expect(result).toHaveProperty('trace_id', 'abc123');
    });
  });

  describe('normalizeSeverity', () => {
    it('normalizes known severities', () => {
      expect(diagnoser.testNormalizeSeverity('critical')).toBe('critical');
      expect(diagnoser.testNormalizeSeverity('CRITICAL')).toBe('critical');
      expect(diagnoser.testNormalizeSeverity('warning')).toBe('warning');
      expect(diagnoser.testNormalizeSeverity('WARNING')).toBe('warning');
    });

    it('defaults to info for unknown severities', () => {
      expect(diagnoser.testNormalizeSeverity('unknown')).toBe('info');
      expect(diagnoser.testNormalizeSeverity('low')).toBe('info');
      expect(diagnoser.testNormalizeSeverity('')).toBe('info');
    });
  });

  describe('sanitizeRawData', () => {
    it('only includes relevant fields', () => {
      const data = {
        statusCode: 500,
        responseTime: 1234,
        error: 'timeout',
        secretToken: 'sk_live_abc123',
        internalId: 'xyz',
        url: 'https://example.com',
      };

      const result = diagnoser.testSanitizeRawData(data);

      expect(result).toHaveProperty('statusCode', 500);
      expect(result).toHaveProperty('responseTime', 1234);
      expect(result).toHaveProperty('error', 'timeout');
      expect(result).toHaveProperty('url', 'https://example.com');
      expect(result).not.toHaveProperty('secretToken');
      expect(result).not.toHaveProperty('internalId');
    });
  });
});
