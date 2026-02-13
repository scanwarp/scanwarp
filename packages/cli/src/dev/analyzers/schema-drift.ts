/**
 * Schema drift detection for API routes.
 *
 * Infers a structural schema from JSON responses, stores baselines per
 * route+method, and detects drift: removed fields, type changes, new fields,
 * and null→non-null (or vice-versa) transitions.
 */

import chalk from 'chalk';

// ─── Schema types ───

export type SchemaNode =
  | { kind: 'null' }
  | { kind: 'boolean' }
  | { kind: 'number' }
  | { kind: 'string' }
  | { kind: 'array'; items: SchemaNode | null }
  | { kind: 'object'; fields: Map<string, SchemaNode> }
  | { kind: 'nullable'; inner: SchemaNode };

export interface SchemaDiff {
  type: 'removed' | 'type_changed' | 'added' | 'null_changed';
  path: string;
  detail: string;
}

interface SchemaBaseline {
  schema: SchemaNode;
  /** How many consecutive responses matched the *current* (possibly new) schema */
  consecutiveMatches: number;
  /** If a new schema appears, store it here until auto-accepted */
  pendingSchema: SchemaNode | null;
  /** Consecutive matches of the pending schema */
  pendingMatches: number;
}

// ─── Schema inference ───

export function inferSchema(value: unknown): SchemaNode {
  if (value === null || value === undefined) {
    return { kind: 'null' };
  }

  if (typeof value === 'boolean') return { kind: 'boolean' };
  if (typeof value === 'number') return { kind: 'number' };
  if (typeof value === 'string') return { kind: 'string' };

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { kind: 'array', items: null };
    }
    // Infer from first element (representative sample)
    return { kind: 'array', items: inferSchema(value[0]) };
  }

  if (typeof value === 'object') {
    const fields = new Map<string, SchemaNode>();
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      fields.set(key, inferSchema(val));
    }
    return { kind: 'object', fields };
  }

  return { kind: 'string' }; // fallback
}

// ─── Schema comparison ───

export function compareSchemas(
  baseline: SchemaNode,
  current: SchemaNode,
  path = '$',
): SchemaDiff[] {
  const diffs: SchemaDiff[] = [];

  // Handle nullable wrapper
  const baseKind = baseline.kind === 'nullable' ? baseline.inner.kind : baseline.kind;
  const currKind = current.kind === 'nullable' ? current.inner.kind : current.kind;
  const baseNode = baseline.kind === 'nullable' ? baseline.inner : baseline;
  const currNode = current.kind === 'nullable' ? current.inner : current;

  // Null status changes
  const baseIsNullable = baseline.kind === 'null' || baseline.kind === 'nullable';
  const currIsNullable = current.kind === 'null' || current.kind === 'nullable';

  if (baseIsNullable !== currIsNullable && baseKind === currKind) {
    if (baseIsNullable && !currIsNullable) {
      diffs.push({
        type: 'null_changed',
        path,
        detail: `was nullable, now always ${currKind}`,
      });
    } else if (!baseIsNullable && currIsNullable) {
      diffs.push({
        type: 'null_changed',
        path,
        detail: `was ${baseKind}, now nullable`,
      });
    }
  }

  // Type change (different base kinds)
  if (baseKind !== currKind && baseline.kind !== 'null' && current.kind !== 'null') {
    diffs.push({
      type: 'type_changed',
      path,
      detail: `was ${baseKind}, now ${currKind}`,
    });
    return diffs; // No point comparing children if types differ
  }

  // Object comparison
  if (baseNode.kind === 'object' && currNode.kind === 'object') {
    // Removed fields
    for (const [key, baseFieldSchema] of baseNode.fields) {
      if (!currNode.fields.has(key)) {
        diffs.push({
          type: 'removed',
          path: `${path}.${key}`,
          detail: `field removed (was ${schemaKindLabel(baseFieldSchema)})`,
        });
      } else {
        // Recurse into shared fields
        const currFieldSchema = currNode.fields.get(key)!;
        diffs.push(...compareSchemas(baseFieldSchema, currFieldSchema, `${path}.${key}`));
      }
    }

    // New fields
    for (const [key, currFieldSchema] of currNode.fields) {
      if (!baseNode.fields.has(key)) {
        diffs.push({
          type: 'added',
          path: `${path}.${key}`,
          detail: `new field (${schemaKindLabel(currFieldSchema)})`,
        });
      }
    }
  }

  // Array comparison — compare item schemas
  if (baseNode.kind === 'array' && currNode.kind === 'array') {
    if (baseNode.items && currNode.items) {
      diffs.push(...compareSchemas(baseNode.items, currNode.items, `${path}[]`));
    }
  }

  return diffs;
}

function schemaKindLabel(node: SchemaNode): string {
  switch (node.kind) {
    case 'object': return 'object';
    case 'array': return node.items ? `${schemaKindLabel(node.items)}[]` : 'array';
    case 'nullable': return `${schemaKindLabel(node.inner)}?`;
    default: return node.kind;
  }
}

// ─── Schema Tracker ───

export class SchemaTracker {
  /** Key: "METHOD route" (e.g. "GET /api/products") */
  private baselines = new Map<string, SchemaBaseline>();
  /** Number of consecutive responses with new schema needed to auto-accept */
  private static AUTO_ACCEPT_COUNT = 3;

  /**
   * Process a response body from a route check.
   * Only call for 2xx responses on API routes.
   * Returns diffs if schema drift is detected, empty array otherwise.
   */
  processResponse(route: string, method: string, body: unknown): SchemaDiff[] {
    const key = `${method} ${route}`;
    const currentSchema = inferSchema(body);

    const existing = this.baselines.get(key);
    if (!existing) {
      // First response — store as baseline
      this.baselines.set(key, {
        schema: currentSchema,
        consecutiveMatches: 1,
        pendingSchema: null,
        pendingMatches: 0,
      });
      return [];
    }

    // Compare against baseline
    const diffs = compareSchemas(existing.schema, currentSchema);

    if (diffs.length === 0) {
      // Matches baseline — reset any pending schema
      existing.consecutiveMatches++;
      existing.pendingSchema = null;
      existing.pendingMatches = 0;
      return [];
    }

    // Schema differs from baseline
    if (existing.pendingSchema) {
      // Check if it matches the pending schema
      const pendingDiffs = compareSchemas(existing.pendingSchema, currentSchema);
      if (pendingDiffs.length === 0) {
        existing.pendingMatches++;
        if (existing.pendingMatches >= SchemaTracker.AUTO_ACCEPT_COUNT) {
          // Auto-accept: the new schema has been seen enough times
          existing.schema = existing.pendingSchema;
          existing.consecutiveMatches = existing.pendingMatches;
          existing.pendingSchema = null;
          existing.pendingMatches = 0;
          return []; // Silently accept
        }
        // Still pending — return diffs against original baseline
        return diffs;
      }
      // Different from both baseline and pending — start new pending
      existing.pendingSchema = currentSchema;
      existing.pendingMatches = 1;
      return diffs;
    }

    // First time seeing a different schema — start pending
    existing.pendingSchema = currentSchema;
    existing.pendingMatches = 1;
    return diffs;
  }

  /** Reset the baseline for routes associated with a changed file */
  resetForRoutes(routes: string[]) {
    for (const route of routes) {
      // Reset all methods for this route
      for (const key of this.baselines.keys()) {
        if (key.endsWith(` ${route}`)) {
          this.baselines.delete(key);
        }
      }
    }
  }

  /** Get active baselines (for API status) */
  getBaselineCount(): number {
    return this.baselines.size;
  }

  /** Print schema drift warnings */
  static printDrift(route: string, method: string, diffs: SchemaDiff[]) {
    if (diffs.length === 0) return;

    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    console.log('');
    console.log(chalk.yellow(`   ${time}  ⚠  ${method} ${route}  — schema changed`));

    let hasBreakingChange = false;

    for (const diff of diffs) {
      if (diff.type === 'removed') {
        console.log(chalk.red(`           Removed field: ${diff.path} (${diff.detail})`));
        hasBreakingChange = true;
      } else if (diff.type === 'type_changed') {
        console.log(chalk.yellow(`           Type changed: ${diff.path} (${diff.detail})`));
        hasBreakingChange = true;
      } else if (diff.type === 'added') {
        console.log(chalk.cyan(`           New field: ${diff.path} (${diff.detail})`));
      } else if (diff.type === 'null_changed') {
        console.log(chalk.blue(`           Null changed: ${diff.path} (${diff.detail})`));
        hasBreakingChange = true;
      }
    }

    if (hasBreakingChange) {
      console.log(chalk.yellow(`           ⚠ This may break frontend consumers of this API`));
    }
  }
}
