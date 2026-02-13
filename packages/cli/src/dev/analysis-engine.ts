/**
 * Analysis engine for scanwarp dev.
 *
 * Runs analyzers on incoming traces, deduplicates results so each unique
 * issue is shown only once, and prints "resolved" when an issue goes away.
 */

import chalk from 'chalk';
import type { Analyzer, AnalysisResult, Span } from './analyzers.js';
import { defaultAnalyzers } from './analyzers.js';

// ─── Issue tracking ───

interface TrackedIssue {
  result: AnalysisResult;
  /** Dedup key — rule + normalized message */
  key: string;
  /** Number of traces this issue appeared in */
  hitCount: number;
  /** Timestamp when first seen */
  firstSeen: number;
  /** Timestamp of last occurrence */
  lastSeen: number;
  /** Whether we already printed this issue */
  printed: boolean;
  /** Set to true once we've printed "resolved" for this issue */
  resolved: boolean;
}

export class AnalysisEngine {
  private analyzers: Analyzer[];
  private issues = new Map<string, TrackedIssue>();
  /** Track which issues fired in the most recent analysis pass per trace */
  private lastTraceIssueKeys = new Set<string>();

  constructor(analyzers?: Analyzer[]) {
    this.analyzers = analyzers ?? defaultAnalyzers;
  }

  /**
   * Analyze a complete trace (all spans with the same trace_id).
   * Returns new/changed results that should be printed.
   */
  analyzeTrace(spans: Span[]): void {
    if (spans.length === 0) return;

    const now = Date.now();
    const currentKeys = new Set<string>();

    // Run all analyzers
    for (const analyzer of this.analyzers) {
      const results = analyzer.analyze(spans);
      for (const result of results) {
        const key = this.makeKey(result);
        currentKeys.add(key);

        const existing = this.issues.get(key);
        if (existing) {
          existing.hitCount++;
          existing.lastSeen = now;
          // Don't re-print — already shown
        } else {
          // New issue — track and print
          const tracked: TrackedIssue = {
            result,
            key,
            hitCount: 1,
            firstSeen: now,
            lastSeen: now,
            printed: true,
            resolved: false,
          };
          this.issues.set(key, tracked);
          this.printResult(result);
        }
      }
    }

    // Check for resolved issues — issues that were active in the previous trace
    // from the same route but are no longer firing
    for (const [key, issue] of this.issues) {
      if (
        this.lastTraceIssueKeys.has(key) &&
        !currentKeys.has(key) &&
        !issue.resolved
      ) {
        issue.resolved = true;
        this.printResolved(issue);
      }
    }

    this.lastTraceIssueKeys = currentKeys;
  }

  /** Generate a dedup key from rule + core message content */
  private makeKey(result: AnalysisResult): string {
    // Strip numbers/counts from the message so "executed 23 times" and "executed 24 times"
    // don't create separate entries
    const normalizedMessage = result.message
      .replace(/\d+\s*times/g, 'N times')
      .replace(/\d+ms/g, 'Nms');

    return `${result.rule}:${normalizedMessage}`;
  }

  /** Print a new analysis result inline */
  private printResult(result: AnalysisResult) {
    const icon = result.severity === 'error'
      ? chalk.red('!')
      : result.severity === 'warning'
        ? chalk.yellow('!')
        : chalk.blue('i');

    const severityColor = result.severity === 'error'
      ? chalk.red
      : result.severity === 'warning'
        ? chalk.yellow
        : chalk.blue;

    const tag = severityColor(`[${result.rule}]`);
    console.log(`\n           ${icon} ${tag} ${result.message}`);

    if (result.suggestion) {
      console.log(chalk.gray(`             → ${result.suggestion}`));
    }
  }

  /** Print when an issue is resolved */
  private printResolved(issue: TrackedIssue) {
    const tag = chalk.green(`[${issue.result.rule}]`);
    // Truncate the message for the resolved line
    const shortMsg = issue.result.message.length > 60
      ? issue.result.message.substring(0, 60) + '...'
      : issue.result.message;
    console.log(`\n           ${chalk.green('✓')} ${tag} ${chalk.green('Resolved:')} ${chalk.gray(shortMsg)}`);
  }

  /** Get count of currently active (unresolved) issues */
  get activeIssueCount(): number {
    let count = 0;
    for (const issue of this.issues.values()) {
      if (!issue.resolved) count++;
    }
    return count;
  }

  /** Get all tracked issues (for session summary) */
  getSummary(): { total: number; active: number; resolved: number; byRule: Map<string, number> } {
    let active = 0;
    let resolved = 0;
    const byRule = new Map<string, number>();

    for (const issue of this.issues.values()) {
      if (issue.resolved) {
        resolved++;
      } else {
        active++;
      }

      const count = byRule.get(issue.result.rule) || 0;
      byRule.set(issue.result.rule, count + 1);
    }

    return { total: this.issues.size, active, resolved, byRule };
  }
}
