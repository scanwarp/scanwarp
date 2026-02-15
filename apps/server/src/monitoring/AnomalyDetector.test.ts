import { describe, it, expect } from 'vitest';
import { AnomalyDetector } from './AnomalyDetector.js';

// Minimal mock database
function makeMockDb(overrides: Record<string, unknown> = {}) {
  return {
    getSimilarErrorCount: async () => 0,
    getRecentErrorCount: async () => 0,
    getBaselineErrorRate: async () => 0,
    flagEventForDiagnosis: async () => {},
    ...overrides,
  } as unknown as ConstructorParameters<typeof AnomalyDetector>[0];
}

describe('AnomalyDetector', () => {
  describe('extractErrorPattern', () => {
    it('preserves HTTP status codes', () => {
      const detector = new AnomalyDetector(makeMockDb());

      const pattern1 = detector.extractErrorPattern('HTTP 404 on /api/users');
      const pattern2 = detector.extractErrorPattern('HTTP 500 on /api/users');

      // These should produce DIFFERENT patterns since status codes differ
      expect(pattern1).not.toBe(pattern2);
      expect(pattern1).toContain('404');
      expect(pattern2).toContain('500');
    });

    it('strips non-HTTP numbers', () => {
      const detector = new AnomalyDetector(makeMockDb());

      const pattern1 = detector.extractErrorPattern('Connection timeout after 30s to db-primary');
      const pattern2 = detector.extractErrorPattern('Connection timeout after 60s to db-primary');

      // These should produce the SAME pattern
      expect(pattern1).toBe(pattern2);
      expect(pattern1).toContain('<N>');
    });

    it('normalizes UUIDs', () => {
      const detector = new AnomalyDetector(makeMockDb());

      const pattern1 = detector.extractErrorPattern('Failed for user 550e8400-e29b-41d4-a716-446655440000');
      const pattern2 = detector.extractErrorPattern('Failed for user 123e4567-e89b-12d3-a456-426614174000');

      expect(pattern1).toBe(pattern2);
      expect(pattern1).toContain('<UUID>');
    });

    it('normalizes dates', () => {
      const detector = new AnomalyDetector(makeMockDb());

      const pattern1 = detector.extractErrorPattern('Error on 2024-01-15 in module');
      const pattern2 = detector.extractErrorPattern('Error on 2024-06-20 in module');

      expect(pattern1).toBe(pattern2);
      expect(pattern1).toContain('<DATE>');
    });

    it('truncates to 50 chars', () => {
      const detector = new AnomalyDetector(makeMockDb());

      const longMessage = 'A'.repeat(100);
      const pattern = detector.extractErrorPattern(longMessage);

      expect(pattern.length).toBe(50);
    });
  });

  describe('analyzeEvent', () => {
    it('detects new error types', async () => {
      const db = makeMockDb({
        getSimilarErrorCount: async () => 0,
      });
      const detector = new AnomalyDetector(db);

      const result = await detector.analyzeEvent({
        id: 'evt-1',
        project_id: 'proj-1',
        monitor_id: 'mon-1',
        type: 'error',
        source: 'monitor',
        message: 'New type of error',
        severity: 'high',
        created_at: new Date(),
      });

      expect(result.isAnomaly).toBe(true);
      expect(result.shouldDiagnose).toBe(true);
      expect(result.reason).toContain('New error type');
    });

    it('detects error rate spikes (3x baseline)', async () => {
      const db = makeMockDb({
        getSimilarErrorCount: async () => 5,
        getRecentErrorCount: async () => 15,
        getBaselineErrorRate: async () => 3,
      });
      const detector = new AnomalyDetector(db);

      const result = await detector.analyzeEvent({
        id: 'evt-1',
        project_id: 'proj-1',
        monitor_id: 'mon-1',
        type: 'error',
        source: 'monitor',
        message: 'Known error',
        severity: 'high',
        created_at: new Date(),
      });

      expect(result.isAnomaly).toBe(true);
      expect(result.shouldDiagnose).toBe(true);
      expect(result.reason).toContain('3x');
    });

    it('does not flag as anomaly when below baseline', async () => {
      const db = makeMockDb({
        getSimilarErrorCount: async () => 5,
        getRecentErrorCount: async () => 2,
        getBaselineErrorRate: async () => 3,
      });
      const detector = new AnomalyDetector(db);

      const result = await detector.analyzeEvent({
        id: 'evt-1',
        project_id: 'proj-1',
        monitor_id: 'mon-1',
        type: 'error',
        source: 'monitor',
        message: 'Known error',
        severity: 'high',
        created_at: new Date(),
      });

      expect(result.isAnomaly).toBe(false);
      expect(result.shouldDiagnose).toBe(false);
    });

    it('skips spike detection when baseline is too low', async () => {
      const db = makeMockDb({
        getSimilarErrorCount: async () => 5,
        getRecentErrorCount: async () => 5,
        getBaselineErrorRate: async () => 0.5,
      });
      const detector = new AnomalyDetector(db);

      const result = await detector.analyzeEvent({
        id: 'evt-1',
        project_id: 'proj-1',
        monitor_id: 'mon-1',
        type: 'error',
        source: 'monitor',
        message: 'Known error',
        severity: 'high',
        created_at: new Date(),
      });

      expect(result.isAnomaly).toBe(false);
    });

    it('returns not anomaly for non-error event types without monitor_id', async () => {
      const detector = new AnomalyDetector(makeMockDb());

      const result = await detector.analyzeEvent({
        id: 'evt-1',
        project_id: 'proj-1',
        type: 'up',
        source: 'monitor',
        message: 'Monitor is back up',
        severity: 'low',
        created_at: new Date(),
      });

      expect(result.isAnomaly).toBe(false);
      expect(result.shouldDiagnose).toBe(false);
    });
  });
});
