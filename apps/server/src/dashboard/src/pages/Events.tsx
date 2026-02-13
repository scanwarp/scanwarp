import { useState } from 'react';
import { api } from '../api';
import { Badge } from '../components/Badge';
import { usePolling, timeAgo } from '../hooks';

const TYPE_OPTIONS = ['', 'error', 'down', 'up', 'slow', 'trace_error', 'slow_query'];
const SOURCE_OPTIONS = ['', 'monitor', 'otel', 'github', 'stripe', 'supabase', 'vercel', 'provider-status'];

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Events</h1>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-300"
        >
          <option value="">All types</option>
          {TYPE_OPTIONS.filter(Boolean).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-300"
        >
          <option value="">All sources</option>
          {SOURCE_OPTIONS.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="text-xs text-gray-500 ml-auto">Polling every 10s</span>
      </div>

      {loading && events.length === 0 ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : events.length === 0 ? (
        <p className="text-gray-500 text-sm">No events found</p>
      ) : (
        <div className="bg-gray-900 rounded-lg border border-gray-800 divide-y divide-gray-800">
          {events.map((e) => (
            <div key={e.id} className="p-3 flex items-start gap-2">
              <Badge label={e.type} />
              <Badge label={e.severity} />
              <div className="min-w-0 flex-1">
                <p className="text-sm">{e.message}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {e.source} &middot; {timeAgo(e.created_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
