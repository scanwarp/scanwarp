import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { TraceWaterfall } from '../components/TraceWaterfall';
import { useFetch } from '../hooks';

export function TraceDetail() {
  const { traceId } = useParams<{ traceId: string }>();
  const { data, loading } = useFetch(() => api.getTrace(traceId!), [traceId]);

  const spans = data?.spans ?? [];

  if (loading) return <p className="text-brown text-sm">Loading trace details...</p>;
  if (spans.length === 0) return <p className="text-brown text-sm">Trace not found</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/traces" className="link-brand text-xs">&larr; Back to Traces</Link>
        <h1 className="pixel-heading text-brown-darker mt-3" style={{ fontSize: 'clamp(0.8rem, 2vw, 1.1rem)' }}>Request Timeline</h1>
        <p className="text-sm text-brown mt-1">
          This shows every step of the request — each bar is one operation. Longer bars mean slower steps.
        </p>
        <p className="text-xs mt-2 font-mono bg-charcoal text-sand px-3 py-1.5 border-[2px] border-brown-dark inline-block">Trace ID: {traceId}</p>
      </div>

      <div className="card p-5 overflow-x-auto">
        <TraceWaterfall spans={spans} />
      </div>
    </div>
  );
}
