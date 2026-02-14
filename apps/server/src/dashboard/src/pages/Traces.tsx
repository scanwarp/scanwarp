import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Badge } from '../components/Badge';
import { usePolling, timeAgo } from '../hooks';

function friendlyDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function Traces() {
  const [statusFilter, setStatusFilter] = useState('');
  const [projectId, setProjectId] = useState('');

  const projects = usePolling(
    () => fetch('/projects').then((r) => r.json()) as Promise<Array<{ id: string; name: string }>>,
    60000,
  );
  const projectList = Array.isArray(projects.data) ? projects.data : [];

  const activeProjectId = projectId || projectList[0]?.id || '';

  const params: Record<string, string> = { limit: '30' };
  if (activeProjectId) params.project_id = activeProjectId;
  if (statusFilter) params.status = statusFilter;

  const { data, loading } = usePolling(
    () => activeProjectId ? api.getTraces(params) : Promise.resolve({ traces: [] }),
    15000,
    [activeProjectId, statusFilter],
  );
  const traces = data?.traces ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Request Traces</h1>
        <p className="text-sm text-gray-500 mt-1">
          Each trace shows the full journey of a request through your app — what it called, how long each step took, and where things went wrong.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {projectList.length > 1 && (
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="filter-select"
          >
            {projectList.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="filter-select"
        >
          <option value="">All requests</option>
          <option value="error">Failed requests only</option>
          <option value="ok">Successful only</option>
        </select>
      </div>

      {!activeProjectId ? (
        <div className="card p-8 text-center">
          <p className="text-gray-400">No projects found</p>
          <p className="text-xs text-gray-600 mt-1">Set up tracing in your app to see request data here.</p>
        </div>
      ) : loading && traces.length === 0 ? (
        <p className="text-gray-500 text-sm">Loading traces...</p>
      ) : traces.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-400">No traces found</p>
          <p className="text-xs text-gray-600 mt-1">Try changing your filters or wait for new requests to come in.</p>
        </div>
      ) : (
        <div className="card divide-y divide-[#1e2333]">
          {traces.map((t) => (
            <Link
              key={t.trace_id}
              to={`/traces/${t.trace_id}`}
              className="p-4 flex items-center gap-3 hover:bg-surface-overlay/50 transition-colors block"
            >
              <Badge label={t.has_errors ? 'error' : 'ok'} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-mono truncate text-gray-200">
                  {t.root_span.operation_name}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {t.root_span.service_name} · {t.span_count} step{t.span_count > 1 ? 's' : ''} · took {friendlyDuration(t.max_duration_ms)}
                </p>
              </div>
              <span className="text-xs text-gray-500 shrink-0">
                {timeAgo(new Date(t.root_span.start_time).toISOString())}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
