import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { Badge } from '../components/Badge';
import { Waterfall } from '../components/Waterfall';
import { useFetch } from '../hooks';

export function TraceDetail() {
  const { traceId } = useParams<{ traceId: string }>();
  const { data, loading } = useFetch(() => api.getTrace(traceId!), [traceId]);

  const spans = data?.spans ?? [];

  if (loading) return <p className="text-gray-500 text-sm">Loading...</p>;
  if (spans.length === 0) return <p className="text-gray-500 text-sm">Trace not found</p>;

  const root = spans.find((s) => !s.parent_span_id) ?? spans[0];
  const totalDuration = Math.max(...spans.map((s) => s.duration_ms));
  const hasErrors = spans.some((s) => s.status_code === 'ERROR');

  return (
    <div className="space-y-6">
      <div>
        <Link to="/traces" className="text-xs text-blue-400 hover:underline">&larr; Traces</Link>
        <h1 className="text-xl font-bold mt-2 font-mono break-all">{root.operation_name}</h1>
        <div className="flex items-center gap-3 mt-2">
          <Badge label={hasErrors ? 'error' : 'ok'} />
          <span className="text-sm text-gray-400">{root.service_name}</span>
          <span className="text-sm text-gray-500">{totalDuration}ms</span>
          <span className="text-sm text-gray-500">{spans.length} span(s)</span>
        </div>
        <p className="text-xs text-gray-600 mt-1 font-mono">trace: {traceId}</p>
      </div>

      {/* Waterfall */}
      <section>
        <h2 className="font-semibold text-gray-300 mb-3">Waterfall</h2>
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 overflow-x-auto">
          <Waterfall spans={spans} />
        </div>
      </section>

      {/* Span details table */}
      <section>
        <h2 className="font-semibold text-gray-300 mb-3">Spans</h2>
        <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500 uppercase tracking-wide">
                <th className="text-left p-2 font-medium">Service</th>
                <th className="text-left p-2 font-medium">Operation</th>
                <th className="text-left p-2 font-medium">Kind</th>
                <th className="text-left p-2 font-medium">Status</th>
                <th className="text-right p-2 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 font-mono">
              {spans.map((s) => (
                <tr key={s.span_id} className="hover:bg-gray-800/50">
                  <td className="p-2 text-gray-400">{s.service_name}</td>
                  <td className="p-2 truncate max-w-xs">{s.operation_name}</td>
                  <td className="p-2 text-gray-500">{s.kind}</td>
                  <td className="p-2">
                    <Badge label={s.status_code === 'ERROR' ? 'error' : s.status_code?.toLowerCase() || 'unset'} />
                  </td>
                  <td className="p-2 text-right text-gray-400">{s.duration_ms}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
