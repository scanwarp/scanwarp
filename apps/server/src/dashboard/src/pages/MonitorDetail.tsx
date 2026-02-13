import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { Badge } from '../components/Badge';
import { useFetch, timeAgo } from '../hooks';

export function MonitorDetail() {
  const { id } = useParams<{ id: string }>();
  const monitor = useFetch(() => api.getMonitor(id!), [id]);
  const events = useFetch(() => api.getEvents({ monitor_id: id!, limit: '50' }), [id]);

  const m = monitor.data?.monitor;
  const eventList = events.data?.events ?? [];

  if (monitor.loading) return <p className="text-gray-500 text-sm">Loading...</p>;
  if (!m) return <p className="text-gray-500 text-sm">Monitor not found</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/monitors" className="text-xs text-blue-400 hover:underline">&larr; Monitors</Link>
        <h1 className="text-xl font-bold mt-2 break-all">{m.url}</h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <p className="text-xs text-gray-500 uppercase">Status</p>
          <div className="mt-1"><Badge label={m.status} /></div>
        </div>
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <p className="text-xs text-gray-500 uppercase">Interval</p>
          <p className="text-lg font-bold mt-1">{m.check_interval_seconds}s</p>
        </div>
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <p className="text-xs text-gray-500 uppercase">Last Check</p>
          <p className="text-sm mt-1 text-gray-300">{m.last_checked_at ? timeAgo(m.last_checked_at) : 'never'}</p>
        </div>
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <p className="text-xs text-gray-500 uppercase">Events</p>
          <p className="text-lg font-bold mt-1">{eventList.length}</p>
        </div>
      </div>

      {/* Response time chart placeholder — simple bar visualization */}
      {eventList.length > 0 && (
        <section>
          <h2 className="font-semibold text-gray-300 mb-3">Recent Response Times</h2>
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <ResponseBars events={eventList} />
          </div>
        </section>
      )}

      {/* Events */}
      <section>
        <h2 className="font-semibold text-gray-300 mb-3">Recent Events</h2>
        <div className="bg-gray-900 rounded-lg border border-gray-800 divide-y divide-gray-800">
          {eventList.length === 0 ? (
            <p className="p-4 text-gray-500 text-sm">No events yet</p>
          ) : (
            eventList.slice(0, 20).map((e) => (
              <div key={e.id} className="p-3 flex items-start gap-2">
                <Badge label={e.type} />
                <div className="min-w-0">
                  <p className="text-sm truncate">{e.message}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{timeAgo(e.created_at)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ResponseBars({ events }: { events: Array<{ raw_data: Record<string, unknown> | null; created_at: string }> }) {
  const points = events
    .map((e) => ({
      time: e.created_at,
      ms: typeof e.raw_data?.responseTime === 'number' ? (e.raw_data.responseTime as number) : null,
    }))
    .filter((p): p is { time: string; ms: number } => p.ms !== null)
    .slice(0, 30)
    .reverse();

  if (points.length === 0) return <p className="text-gray-500 text-sm">No response time data</p>;

  const maxMs = Math.max(...points.map((p) => p.ms), 1);

  return (
    <div className="flex items-end gap-1 h-24">
      {points.map((p, i) => (
        <div
          key={i}
          className="flex-1 bg-blue-500/60 rounded-t hover:bg-blue-400/70 transition-colors"
          style={{ height: `${(p.ms / maxMs) * 100}%` }}
          title={`${p.ms}ms — ${new Date(p.time).toLocaleTimeString()}`}
        />
      ))}
    </div>
  );
}
