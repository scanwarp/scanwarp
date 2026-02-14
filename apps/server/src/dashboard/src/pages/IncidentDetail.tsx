import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { Badge } from '../components/Badge';
import { TraceWaterfall } from '../components/TraceWaterfall';
import { useFetch, timeAgo } from '../hooks';

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

export function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const incident = useFetch(() => api.getIncident(id!), [id]);
  const traces = useFetch(() => api.getIncidentTraces(id!), [id]);

  const inc = incident.data?.incident;
  const incidentEvents = incident.data?.events ?? [];
  const spans = traces.data?.spans ?? [];

  if (incident.loading) return <p className="text-gray-500 text-sm">Loading issue details...</p>;
  if (!inc) return <p className="text-gray-500 text-sm">Issue not found</p>;

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
      {/* Header */}
      <div>
        <Link to="/incidents" className="link-brand text-xs">&larr; Back to Issues</Link>
        <div className="flex items-center gap-3 mt-3">
          <h1 className="text-2xl font-bold text-white">Issue Details</h1>
          <Badge label={inc.status} />
          <Badge label={inc.severity} />
          {inc.status === 'open' && (
            <button onClick={handleResolve} className="btn-success ml-auto">
              Mark as Fixed
            </button>
          )}
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Detected {timeAgo(inc.created_at)}
          {inc.resolved_at && <> · Fixed {timeAgo(inc.resolved_at)}</>}
        </p>
      </div>

      {/* AI Diagnosis — the core value prop */}
      {(inc.diagnosis_text || inc.diagnosis_fix || inc.fix_prompt) && (
        <section className="space-y-4">
          <div>
            <h2 className="section-title">What ScanWarp Found</h2>
            <p className="text-xs text-gray-500 mt-0.5">AI analyzed the errors and figured out what's going on.</p>
          </div>

          {inc.diagnosis_text && (
            <div className="card p-5">
              <p className="text-xs text-gray-500 font-medium mb-2">Why this happened</p>
              <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{inc.diagnosis_text}</p>
            </div>
          )}

          {inc.diagnosis_fix && (
            <div className="card p-5 border-emerald-500/20">
              <p className="text-xs text-emerald-400 font-medium mb-2">How to fix it</p>
              <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{inc.diagnosis_fix}</p>
            </div>
          )}

          {inc.fix_prompt && (
            <div className="card p-5 border-brand-500/20">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs text-brand-400 font-medium">Auto-fix prompt</p>
                  <p className="text-xs text-gray-500 mt-0.5">Copy this and paste it into Cursor or Claude Code to fix automatically</p>
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(inc.fix_prompt!)}
                  className="btn-primary text-xs"
                >
                  Copy prompt
                </button>
              </div>
              <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono bg-surface rounded-lg p-4 border border-[#1e2333]">
                {inc.fix_prompt}
              </pre>
            </div>
          )}
        </section>
      )}

      {/* Related Events */}
      <section>
        <div className="mb-3">
          <h2 className="section-title">Related Events ({incidentEvents.length})</h2>
          <p className="text-xs text-gray-500 mt-0.5">All the errors and events connected to this issue</p>
        </div>
        <div className="card divide-y divide-[#1e2333]">
          {incidentEvents.length === 0 ? (
            <p className="p-5 text-gray-500 text-sm text-center">No related events found</p>
          ) : (
            incidentEvents.map((e) => (
              <div key={e.id} className="p-4 flex items-start gap-3">
                <div className="flex flex-col gap-1 shrink-0 pt-0.5">
                  <Badge label={e.type} />
                  <Badge label={e.severity} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-gray-200">{e.message}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    from <span className="text-gray-400">{sourceLabels[e.source] || e.source}</span> · {timeAgo(e.created_at)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Trace Waterfall */}
      {spans.length > 0 && (
        <section>
          <div className="mb-3">
            <h2 className="section-title">Request Timeline</h2>
            <p className="text-xs text-gray-500 mt-0.5">Visual breakdown of how the request flowed through your system</p>
          </div>
          <div className="card p-4 overflow-x-auto">
            <TraceWaterfall spans={spans} />
          </div>
        </section>
      )}
    </div>
  );
}
