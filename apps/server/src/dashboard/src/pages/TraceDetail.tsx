import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { TraceWaterfall } from '../components/TraceWaterfall';
import { useFetch } from '../hooks';

export function TraceDetail() {
  const { traceId } = useParams<{ traceId: string }>();
  const { data, loading } = useFetch(() => api.getTrace(traceId!), [traceId]);

  const spans = data?.spans ?? [];

  if (loading) return <p className="text-gray-500 text-sm">Loading...</p>;
  if (spans.length === 0) return <p className="text-gray-500 text-sm">Trace not found</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/traces" className="text-xs text-blue-400 hover:underline">&larr; Traces</Link>
        <p className="text-xs text-gray-600 mt-2 font-mono">trace: {traceId}</p>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 overflow-x-auto">
        <TraceWaterfall spans={spans} />
      </div>
    </div>
  );
}
