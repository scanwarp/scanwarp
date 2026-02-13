import type { Span } from '../api';

export function Waterfall({ spans }: { spans: Span[] }) {
  if (spans.length === 0) return <p className="text-gray-500 text-sm">No spans</p>;

  const sorted = [...spans].sort((a, b) => a.start_time - b.start_time);
  const minStart = sorted[0].start_time;
  const maxEnd = Math.max(...sorted.map((s) => s.start_time + s.duration_ms));
  const totalDuration = maxEnd - minStart || 1;

  // Build parent map for indentation
  const depthMap = new Map<string, number>();
  for (const s of sorted) {
    if (!s.parent_span_id) {
      depthMap.set(s.span_id, 0);
    } else {
      const parentDepth = depthMap.get(s.parent_span_id) ?? 0;
      depthMap.set(s.span_id, parentDepth + 1);
    }
  }

  return (
    <div className="space-y-0.5 text-xs font-mono">
      {sorted.map((span) => {
        const left = ((span.start_time - minStart) / totalDuration) * 100;
        const width = Math.max((span.duration_ms / totalDuration) * 100, 0.5);
        const depth = depthMap.get(span.span_id) ?? 0;
        const isError = span.status_code === 'ERROR';

        return (
          <div key={span.span_id} className="flex items-center gap-2 h-6">
            <div
              className="shrink-0 text-gray-400 truncate"
              style={{ width: 200, paddingLeft: depth * 12 }}
              title={`${span.service_name}: ${span.operation_name}`}
            >
              <span className="text-gray-500">{span.service_name}</span>{' '}
              {span.operation_name}
            </div>
            <div className="flex-1 relative h-4 bg-gray-800/50 rounded overflow-hidden">
              <div
                className={`absolute top-0 h-full rounded ${
                  isError ? 'bg-red-500/70' : 'bg-blue-500/60'
                }`}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </div>
            <span className="shrink-0 w-16 text-right text-gray-500">
              {span.duration_ms}ms
            </span>
          </div>
        );
      })}
    </div>
  );
}
