import { useState, Fragment } from 'react';
import type { Span } from '../api';
import { Badge } from './Badge';

// ─── Tree node used internally ───

interface SpanNode {
  span: Span;
  children: SpanNode[];
  depth: number;
}

// ─── Color logic (retro palette) ───

function spanColor(span: Span): string {
  if (span.status_code === 'ERROR') return 'bg-accent-red/80';

  const attrs = span.attributes;
  const isDb = !!(attrs['db.system'] || attrs['db.statement']);
  const isHttp = span.kind === 'CLIENT' && !!(attrs['http.url'] || attrs['http.method'] || attrs['url.full']);

  // Slow thresholds
  if (isDb && span.duration_ms > 500) return 'bg-accent-glow/80';
  if (isHttp && span.duration_ms > 2000) return 'bg-accent-glow/80';

  if (isDb) return 'bg-purple-600/70';
  if (isHttp) return 'bg-accent-blue/70';

  return 'bg-accent-green/60';
}

function spanColorLabel(span: Span): string {
  if (span.status_code === 'ERROR') return 'error';
  const attrs = span.attributes;
  const isDb = !!(attrs['db.system'] || attrs['db.statement']);
  const isHttp = span.kind === 'CLIENT' && !!(attrs['http.url'] || attrs['http.method'] || attrs['url.full']);
  if (isDb && span.duration_ms > 500) return 'slow (db)';
  if (isHttp && span.duration_ms > 2000) return 'slow (http)';
  if (isDb) return 'database';
  if (isHttp) return 'http client';
  return 'ok';
}

// ─── Build a tree from flat span list ───

function buildTree(spans: Span[]): SpanNode[] {
  const byId = new Map<string, SpanNode>();
  const roots: SpanNode[] = [];

  // Create nodes
  for (const span of spans) {
    byId.set(span.span_id, { span, children: [], depth: 0 });
  }

  // Link parents
  for (const span of spans) {
    const node = byId.get(span.span_id)!;
    if (span.parent_span_id && byId.has(span.parent_span_id)) {
      byId.get(span.parent_span_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children by start_time and assign depths
  function assignDepth(node: SpanNode, depth: number) {
    node.depth = depth;
    node.children.sort((a, b) => a.span.start_time - b.span.start_time);
    for (const child of node.children) {
      assignDepth(child, depth + 1);
    }
  }
  roots.sort((a, b) => a.span.start_time - b.span.start_time);
  for (const root of roots) {
    assignDepth(root, 0);
  }

  return roots;
}

// Flatten tree into display order
function flatten(nodes: SpanNode[]): SpanNode[] {
  const result: SpanNode[] = [];
  function walk(node: SpanNode) {
    result.push(node);
    for (const child of node.children) {
      walk(child);
    }
  }
  for (const root of nodes) walk(root);
  return result;
}

// ─── Interesting attributes to show in detail panel ───

const NOTABLE_ATTRS = [
  'http.method', 'http.url', 'http.status_code', 'http.route', 'http.target', 'url.full',
  'db.system', 'db.statement', 'db.name',
  'error.message', 'error.type', 'exception.message', 'exception.type',
  'rpc.system', 'rpc.method', 'rpc.service',
  'messaging.system', 'messaging.destination',
  'net.peer.name', 'net.peer.port', 'server.address',
];

function getInterestingAttrs(span: Span): [string, string][] {
  const result: [string, string][] = [];
  // Notable attrs first
  for (const key of NOTABLE_ATTRS) {
    const val = span.attributes[key];
    if (val !== undefined && val !== null && val !== '') {
      result.push([key, String(val)]);
    }
  }
  // Then remaining attrs
  for (const [key, val] of Object.entries(span.attributes)) {
    if (!NOTABLE_ATTRS.includes(key) && val !== undefined && val !== null && val !== '') {
      result.push([key, String(val)]);
    }
  }
  return result;
}

// ─── Summary header ───

function SummaryHeader({ spans }: { spans: Span[] }) {
  if (spans.length === 0) return null;

  const root = spans.find((s) => !s.parent_span_id) ?? spans[0];
  const totalDuration = Math.max(...spans.map((s) => s.start_time + s.duration_ms)) -
    Math.min(...spans.map((s) => s.start_time));
  const hasErrors = spans.some((s) => s.status_code === 'ERROR');

  // Try to extract HTTP method from root span attributes
  const method = root.attributes['http.method'] || root.attributes['http.request.method'] || root.kind;
  const operation = root.operation_name;

  return (
    <div className="flex items-center gap-2 px-1 pb-3 mb-3 border-b border-sand-dark text-sm flex-wrap">
      <span className="font-mono font-semibold text-brown-darker">
        {method && method !== root.kind ? `${method} ` : ''}{operation}
      </span>
      <span className="text-brown">&middot;</span>
      <span className="text-brown-dark">{totalDuration}ms</span>
      <span className="text-brown">&middot;</span>
      <span className="text-brown-dark">{spans.length} span{spans.length !== 1 ? 's' : ''}</span>
      <span className="text-brown">&middot;</span>
      <Badge label={hasErrors ? 'error' : 'ok'} />
    </div>
  );
}

// ─── Span detail panel ───

function SpanDetails({ span, onClose }: { span: Span; onClose: () => void }) {
  const attrs = getInterestingAttrs(span);

  return (
    <div className="mt-1 mb-2 ml-4 bg-charcoal border-[2px] border-brown-dark p-3 text-xs text-sand">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-cream">{span.service_name}: {span.operation_name}</span>
        <button onClick={onClose} className="text-brown hover:text-sand px-1">&times;</button>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sand-dark">
        <span className="text-brown">span_id</span>
        <span className="font-mono">{span.span_id}</span>
        <span className="text-brown">kind</span>
        <span>{span.kind}</span>
        <span className="text-brown">status</span>
        <span>
          <Badge label={span.status_code === 'ERROR' ? 'error' : span.status_code?.toLowerCase() || 'unset'} />
          {span.status_message && <span className="ml-2 text-accent-red">{span.status_message}</span>}
        </span>
        <span className="text-brown">duration</span>
        <span>{span.duration_ms}ms</span>
        {attrs.map(([key, val]) => (
          <Fragment key={key}>
            <span className="text-brown truncate" title={key}>{key}</span>
            <span className="font-mono break-all max-h-20 overflow-y-auto">{val}</span>
          </Fragment>
        ))}
        {span.events.length > 0 && (
          <>
            <span className="text-brown pt-1 border-t border-brown-dark">events</span>
            <div className="pt-1 border-t border-brown-dark space-y-1">
              {span.events.map((ev, i) => (
                <div key={i}>
                  <span className="text-accent-glow">{ev.name}</span>
                  {ev.attributes && Object.keys(ev.attributes).length > 0 && (
                    <span className="text-brown ml-1">
                      {Object.entries(ev.attributes).map(([k, v]) => `${k}=${v}`).join(', ')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───

export function TraceWaterfall({ spans }: { spans: Span[] }) {
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  if (spans.length === 0) return <p className="text-brown text-sm">No spans</p>;

  const tree = buildTree(spans);
  const flat = flatten(tree);

  const minStart = Math.min(...spans.map((s) => s.start_time));
  const maxEnd = Math.max(...spans.map((s) => s.start_time + s.duration_ms));
  const totalDuration = maxEnd - minStart || 1;

  // Time axis labels
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((pct) => ({
    pct: pct * 100,
    label: `${Math.round(pct * totalDuration)}ms`,
  }));

  return (
    <div>
      <SummaryHeader spans={spans} />

      {/* Time axis */}
      <div className="flex items-center gap-2 mb-1 text-[10px] text-brown">
        <div style={{ width: 220 }} className="shrink-0" />
        <div className="flex-1 relative h-4">
          {ticks.map((t) => (
            <span
              key={t.pct}
              className="absolute -translate-x-1/2"
              style={{ left: `${t.pct}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>
        <div className="shrink-0 w-16" />
      </div>

      {/* Span rows */}
      <div className="text-xs font-mono">
        {flat.map(({ span, depth }) => {
          const left = ((span.start_time - minStart) / totalDuration) * 100;
          const width = Math.max((span.duration_ms / totalDuration) * 100, 0.4);
          const isSelected = selectedSpanId === span.span_id;
          const color = spanColor(span);
          const label = spanColorLabel(span);

          return (
            <div key={span.span_id}>
              <div
                className={`flex items-center gap-2 h-7 cursor-pointer transition-colors ${
                  isSelected ? 'bg-sand-dark/60' : 'hover:bg-sand-dark/30'
                }`}
                onClick={() => setSelectedSpanId(isSelected ? null : span.span_id)}
                title={`${span.service_name}: ${span.operation_name} — ${span.duration_ms}ms (${label})`}
              >
                {/* Label column */}
                <div
                  className="shrink-0 text-brown-dark truncate flex items-center gap-1"
                  style={{ width: 220, paddingLeft: depth * 16 }}
                >
                  {/* Tree connector */}
                  {depth > 0 && (
                    <span className="text-sand-dark select-none">└</span>
                  )}
                  <span className="text-brown text-[10px]">{span.service_name}</span>
                  <span className="truncate">{span.operation_name}</span>
                </div>

                {/* Bar column */}
                <div className="flex-1 relative h-5 bg-sand-dark/30 overflow-hidden">
                  <div
                    className={`absolute top-0.5 bottom-0.5 ${color} transition-all`}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      minWidth: 3,
                    }}
                  />
                </div>

                {/* Duration column */}
                <span className="shrink-0 w-16 text-right text-brown tabular-nums">
                  {span.duration_ms < 1 ? '<1' : span.duration_ms}ms
                </span>
              </div>

              {/* Detail panel */}
              {isSelected && (
                <SpanDetails
                  span={span}
                  onClose={() => setSelectedSpanId(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-sand-dark text-[10px] text-brown">
        <LegendDot color="bg-accent-green/60" label="Success" />
        <LegendDot color="bg-accent-red/80" label="Error" />
        <LegendDot color="bg-accent-glow/80" label="Slow" />
        <LegendDot color="bg-accent-blue/70" label="HTTP Client" />
        <LegendDot color="bg-purple-600/70" label="Database" />
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`w-2 h-2 ${color}`} />
      {label}
    </span>
  );
}
