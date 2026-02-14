/* ── Style definitions ── */
const badgeStyles: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/25',
  high: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  low: 'bg-brand-500/15 text-brand-400 border-brand-500/25',
  info: 'bg-brand-500/15 text-brand-400 border-brand-500/25',
  warning: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  error: 'bg-red-500/15 text-red-400 border-red-500/25',
  down: 'bg-red-500/15 text-red-400 border-red-500/25',
  up: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  slow: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  trace_error: 'bg-red-500/15 text-red-400 border-red-500/25',
  slow_query: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  open: 'bg-red-500/15 text-red-400 border-red-500/25',
  resolved: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  ok: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  unknown: 'bg-gray-500/15 text-gray-400 border-gray-500/25',
};

/* ── Human-readable display names ── */
const friendlyNames: Record<string, string> = {
  critical: 'Critical',
  high: 'High Priority',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
  warning: 'Warning',
  error: 'Error',
  down: 'Offline',
  up: 'Online',
  slow: 'Slow',
  trace_error: 'Code Error',
  slow_query: 'Slow Database',
  open: 'Needs Attention',
  resolved: 'Fixed',
  ok: 'Healthy',
  unknown: 'Unknown',
};

/* ── Tooltip hints for non-technical users ── */
const tooltips: Record<string, string> = {
  critical: 'Something is seriously broken and needs immediate attention',
  high: 'An important problem that should be looked at soon',
  medium: 'Something worth checking when you get a chance',
  low: 'A minor issue, not urgent',
  info: 'Just letting you know — no action needed',
  warning: 'Not broken yet, but could become a problem',
  error: 'Something went wrong in your app',
  down: 'This service is not responding',
  up: 'This service is working normally',
  slow: 'This is taking longer than expected',
  trace_error: 'An error was found in your code\'s execution',
  slow_query: 'A database query is running slowly',
  open: 'This issue hasn\'t been resolved yet',
  resolved: 'This issue has been fixed',
  ok: 'Everything is working as expected',
  unknown: 'We\'re not sure about the status yet',
};

export function Badge({ label }: { label: string }) {
  const cls = badgeStyles[label] || badgeStyles['unknown'];
  const displayName = friendlyNames[label] || label;
  const tooltip = tooltips[label];

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-md border ${cls}`}
      title={tooltip}
    >
      {displayName}
    </span>
  );
}
