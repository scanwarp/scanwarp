const colors: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  info: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  warning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  error: 'bg-red-500/20 text-red-400 border-red-500/30',
  down: 'bg-red-500/20 text-red-400 border-red-500/30',
  up: 'bg-green-500/20 text-green-400 border-green-500/30',
  slow: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  trace_error: 'bg-red-500/20 text-red-400 border-red-500/30',
  slow_query: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  open: 'bg-red-500/20 text-red-400 border-red-500/30',
  resolved: 'bg-green-500/20 text-green-400 border-green-500/30',
  ok: 'bg-green-500/20 text-green-400 border-green-500/30',
  unknown: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

export function Badge({ label }: { label: string }) {
  const cls = colors[label] || colors['unknown'];
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded border ${cls}`}>
      {label}
    </span>
  );
}
