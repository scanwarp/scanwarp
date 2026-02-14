/* ── Style definitions (retro landing page palette) ── */
const badgeStyles: Record<string, string> = {
  critical: 'bg-[#ba4135]/15 text-[#ba4135] border-[#ba4135]',
  high: 'bg-[#a44200]/15 text-[#a44200] border-[#a44200]',
  medium: 'bg-[#E8863E]/15 text-[#a44200] border-[#E8863E]',
  low: 'bg-[#4A7FB5]/15 text-[#4A7FB5] border-[#4A7FB5]',
  info: 'bg-[#4A7FB5]/15 text-[#4A7FB5] border-[#4A7FB5]',
  warning: 'bg-[#E8863E]/15 text-[#a44200] border-[#E8863E]',
  error: 'bg-[#ba4135]/15 text-[#ba4135] border-[#ba4135]',
  down: 'bg-[#ba4135]/15 text-[#ba4135] border-[#ba4135]',
  up: 'bg-[#2c701d]/15 text-[#2c701d] border-[#2c701d]',
  slow: 'bg-[#E8863E]/15 text-[#a44200] border-[#E8863E]',
  trace_error: 'bg-[#ba4135]/15 text-[#ba4135] border-[#ba4135]',
  slow_query: 'bg-[#E8863E]/15 text-[#a44200] border-[#E8863E]',
  open: 'bg-[#ba4135]/15 text-[#ba4135] border-[#ba4135]',
  resolved: 'bg-[#2c701d]/15 text-[#2c701d] border-[#2c701d]',
  ok: 'bg-[#2c701d]/15 text-[#2c701d] border-[#2c701d]',
  unknown: 'bg-[#D4C4A8]/50 text-[#6d5537] border-[#D4C4A8]',
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
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono font-bold border-2 ${cls}`}
      title={tooltip}
    >
      {displayName}
    </span>
  );
}
