import { useState } from 'react';
import { api } from '../api';
import { Badge } from '../components/Badge';
import { usePolling, timeAgo } from '../hooks';

/* Human-readable filter options */
const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All types' },
  { value: 'error', label: 'Errors' },
  { value: 'down', label: 'Service went offline' },
  { value: 'up', label: 'Service came back online' },
  { value: 'slow', label: 'Slow responses' },
  { value: 'trace_error', label: 'Code errors' },
  { value: 'slow_query', label: 'Slow database queries' },
];

const SOURCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All sources' },
  { value: 'monitor', label: 'Health checks' },
  { value: 'otel', label: 'App code' },
  { value: 'github', label: 'GitHub' },
  { value: 'stripe', label: 'Stripe' },
  { value: 'supabase', label: 'Supabase' },
  { value: 'vercel', label: 'Vercel' },
  { value: 'provider-status', label: 'External services' },
];

const sourceLabels: Record<string, string> = {
  monitor: 'Health Check',
  otel: 'App Code',
  github: 'GitHub',
  stripe: 'Stripe',
  supabase: 'Supabase',
  vercel: 'Vercel',
  'provider-status': 'External Service',
  browser: 'Browser',
};

export function Events() {
  const [typeFilter, setTypeFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  const params: Record<string, string> = { limit: '100' };
  if (typeFilter) params.type = typeFilter;
  if (sourceFilter) params.source = sourceFilter;

  const { data, loading } = usePolling(
    () => api.getEvents(params),
    10000,
    [typeFilter, sourceFilter],
  );
  const events = data?.events ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Activity Feed</h1>
        <p className="text-sm text-gray-500 mt-1">Everything happening across your app — errors, slowdowns, status changes, and more.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="filter-select"
        >
          {TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="filter-select"
        >
          {SOURCE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <span className="text-xs text-gray-600 ml-auto flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-scan-pulse" />
          Live — updates every 10s
        </span>
      </div>

      {loading && events.length === 0 ? (
        <p className="text-gray-500 text-sm">Loading activity...</p>
      ) : events.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-400">No activity found</p>
          <p className="text-xs text-gray-600 mt-1">Try changing your filters or check back later.</p>
        </div>
      ) : (
        <div className="card divide-y divide-[#1e2333]">
          {events.map((e) => (
            <div key={e.id} className="p-4 flex items-start gap-3 hover:bg-surface-overlay/50 transition-colors">
              <div className="flex flex-col gap-1 shrink-0 pt-0.5">
                <Badge label={e.type} />
                <Badge label={e.severity} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-200">{e.message}</p>
                <p className="text-xs text-gray-500 mt-1">
                  from <span className="text-gray-400">{sourceLabels[e.source] || e.source}</span> · {timeAgo(e.created_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
