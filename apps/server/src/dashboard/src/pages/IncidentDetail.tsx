import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { Badge } from '../components/Badge';
import { Waterfall } from '../components/Waterfall';
import { useFetch, timeAgo } from '../hooks';

export function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const incident = useFetch(() => api.getIncident(id!), [id]);
  const traces = useFetch(() => api.getIncidentTraces(id!), [id]);

  const inc = incident.data?.incident;
  const incidentEvents = incident.data?.events ?? [];
  const spans = traces.data?.spans ?? [];

  if (incident.loading) return <p className="text-gray-500 text-sm">Loading...</p>;
  if (!inc) return <p className="text-gray-500 text-sm">Incident not found</p>;

  const handleResolve = async () => {
    try {
      await api.resolveIncident(id!);
      incident.refetch();
    } catch (e) {
      console.error('Failed to resolve:', e);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link to="/incidents" className="text-xs text-blue-400 hover:underline">&larr; Incidents</Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-xl font-bold">Incident</h1>
          <Badge label={inc.status} />
          <Badge label={inc.severity} />
          {inc.status === 'open' && (
            <button
              onClick={handleResolve}
              className="ml-auto px-3 py-1 text-sm bg-green-600 hover:bg-green-500 text-white rounded transition-colors"
            >
              Resolve
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Created {timeAgo(inc.created_at)}
          {inc.resolved_at && <> &middot; Resolved {timeAgo(inc.resolved_at)}</>}
        </p>
      </div>

      {/* AI Diagnosis */}
      {(inc.diagnosis_text || inc.diagnosis_fix || inc.fix_prompt) && (
        <section className="space-y-4">
          <h2 className="font-semibold text-gray-300">AI Diagnosis</h2>

          {inc.diagnosis_text && (
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
              <p className="text-xs text-gray-500 uppercase mb-2">Root Cause</p>
              <p className="text-sm text-gray-200 whitespace-pre-wrap">{inc.diagnosis_text}</p>
            </div>
          )}

          {inc.diagnosis_fix && (
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
              <p className="text-xs text-gray-500 uppercase mb-2">Suggested Fix</p>
              <p className="text-sm text-gray-200 whitespace-pre-wrap">{inc.diagnosis_fix}</p>
            </div>
          )}

          {inc.fix_prompt && (
            <div className="bg-gray-900 rounded-lg border border-blue-800/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-blue-400 uppercase">Fix Prompt (for Cursor/Claude Code)</p>
                <button
                  onClick={() => navigator.clipboard.writeText(inc.fix_prompt!)}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Copy
                </button>
              </div>
              <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono bg-gray-950 rounded p-3">
                {inc.fix_prompt}
              </pre>
            </div>
          )}
        </section>
      )}

      {/* Correlated Events */}
      <section>
        <h2 className="font-semibold text-gray-300 mb-3">Correlated Events ({incidentEvents.length})</h2>
        <div className="bg-gray-900 rounded-lg border border-gray-800 divide-y divide-gray-800">
          {incidentEvents.length === 0 ? (
            <p className="p-4 text-gray-500 text-sm">No events</p>
          ) : (
            incidentEvents.map((e) => (
              <div key={e.id} className="p-3 flex items-start gap-2">
                <Badge label={e.type} />
                <Badge label={e.severity} />
                <div className="min-w-0">
                  <p className="text-sm">{e.message}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{e.source} &middot; {timeAgo(e.created_at)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Trace Waterfall */}
      {spans.length > 0 && (
        <section>
          <h2 className="font-semibold text-gray-300 mb-3">Trace Waterfall ({spans.length} spans)</h2>
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 overflow-x-auto">
            <Waterfall spans={spans} />
          </div>
        </section>
      )}
    </div>
  );
}
