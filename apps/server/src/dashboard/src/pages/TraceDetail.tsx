import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { TraceWaterfall } from '../components/TraceWaterfall';
import { useFetch } from '../hooks';

export function TraceDetail() {
  const { traceId } = useParams<{ traceId: string }>();
  const { data, loading } = useFetch(() => api.getTrace(traceId!), [traceId]);

  const spans = data?.spans ?? [];

  if (loading) return <p className="text-gray-500 text-sm">Loading trace details...</p>;
  if (spans.length === 0) return <p className="text-gray-500 text-sm">Trace not found</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/traces" className="link-brand text-xs">&larr; Back to Traces</Link>
        <h1 className="text-2xl font-bold text-white mt-3">Request Timeline</h1>
        <p className="text-sm text-gray-500 mt-1">
          This shows every step of the request — each bar is one operation. Longer bars mean slower steps.
        </p>
        <p className="text-xs text-gray-600 mt-2 font-mono">Trace ID: {traceId}</p>
      </div>

      <div className="card p-5 overflow-x-auto">
        <TraceWaterfall spans={spans} />
      </div>
    </div>
  );
}
