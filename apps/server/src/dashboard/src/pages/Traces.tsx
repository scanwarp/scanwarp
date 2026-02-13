import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Badge } from '../components/Badge';
import { usePolling, timeAgo } from '../hooks';

export function Traces() {
  const [statusFilter, setStatusFilter] = useState('');
  const [projectId, setProjectId] = useState('');

  // We need a project_id for traces — try fetching projects to let user pick
  const projects = usePolling(
    () => fetch('/projects').then((r) => r.json()) as Promise<Array<{ id: string; name: string }>>,
    60000,
  );
  const projectList = Array.isArray(projects.data) ? projects.data : [];

  // Auto-select first project if none selected
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Traces</h1>
        {projectList.length > 1 && (
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-300"
          >
            {projectList.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-300"
        >
          <option value="">All</option>
          <option value="error">Errors only</option>
          <option value="ok">OK only</option>
        </select>
      </div>

      {!activeProjectId ? (
        <p className="text-gray-500 text-sm">No projects found. Send some traces first.</p>
      ) : loading && traces.length === 0 ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : traces.length === 0 ? (
        <p className="text-gray-500 text-sm">No traces found</p>
      ) : (
        <div className="bg-gray-900 rounded-lg border border-gray-800 divide-y divide-gray-800">
          {traces.map((t) => (
            <Link
              key={t.trace_id}
              to={`/traces/${t.trace_id}`}
              className="p-3 flex items-center gap-3 hover:bg-gray-800/50 transition-colors block"
            >
              <Badge label={t.has_errors ? 'error' : 'ok'} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-mono truncate">
                  {t.root_span.operation_name}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {t.root_span.service_name} &middot; {t.span_count} span(s) &middot; {t.max_duration_ms}ms
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
