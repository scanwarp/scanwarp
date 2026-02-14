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
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="pixel-heading text-brown-darker" style={{ fontSize: 'clamp(0.8rem, 2vw, 1.1rem)' }}>Issues</h1>
        <p className="text-sm text-brown mt-1">
          When ScanWarp detects a problem, it groups related errors into an issue and uses AI to figure out what went wrong.
        </p>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="filter-select"
        >
          <option value="">All issues</option>
          <option value="open">Needs attention</option>
          <option value="resolved">Already fixed</option>
        </select>
      </div>

      {loading && incidents.length === 0 ? (
        <p className="text-brown text-sm">Loading issues...</p>
      ) : incidents.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-brown-dark">No issues found</p>
          <p className="text-xs text-brown mt-1">That's a good thing! Your app is running smoothly.</p>
        </div>
      ) : (
        <div className="card divide-y divide-sand-dark">
          {incidents.map((inc) => (
            <Link
              key={inc.id}
              to={`/incidents/${inc.id}`}
              className="p-4 flex items-center gap-3 hover:bg-sand-dark/30 transition-colors block"
            >
              <div className="flex flex-col gap-1 shrink-0">
                <Badge label={inc.status} />
                <Badge label={inc.severity} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">
                  {inc.diagnosis_text?.slice(0, 100) || `Issue with ${inc.events.length} related event${inc.events.length > 1 ? 's' : ''}`}
                </p>
                <p className="text-xs text-brown mt-1">
                  {inc.events.length} related event{inc.events.length > 1 ? 's' : ''} · detected {timeAgo(inc.created_at)}
                  {inc.resolved_at && <> · fixed {timeAgo(inc.resolved_at)}</>}
                </p>
              </div>
              <span className="text-xs text-brown shrink-0 font-mono">View details</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
