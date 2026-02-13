import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Badge } from '../components/Badge';
import { usePolling, timeAgo } from '../hooks';

export function Incidents() {
  const [statusFilter, setStatusFilter] = useState('');

  const params: Record<string, string> = {};
  if (statusFilter) params.status = statusFilter;

  const { data, loading } = usePolling(
    () => api.getIncidents(params),
    15000,
    [statusFilter],
  );
  const incidents = data?.incidents ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Incidents</h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-300"
        >
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      {loading && incidents.length === 0 ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : incidents.length === 0 ? (
        <p className="text-gray-500 text-sm">No incidents</p>
      ) : (
        <div className="bg-gray-900 rounded-lg border border-gray-800 divide-y divide-gray-800">
          {incidents.map((inc) => (
            <Link
              key={inc.id}
              to={`/incidents/${inc.id}`}
              className="p-3 flex items-center gap-3 hover:bg-gray-800/50 transition-colors block"
            >
              <Badge label={inc.status} />
              <Badge label={inc.severity} />
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">
                  {inc.diagnosis_text?.slice(0, 100) || `Incident with ${inc.events.length} event(s)`}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {inc.events.length} event(s) &middot; {timeAgo(inc.created_at)}
                  {inc.resolved_at && <> &middot; resolved {timeAgo(inc.resolved_at)}</>}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
