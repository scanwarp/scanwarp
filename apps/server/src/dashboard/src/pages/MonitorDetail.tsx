import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { Badge } from '../components/Badge';
import { useFetch, timeAgo } from '../hooks';

function friendlyInterval(seconds: number): string {
  if (seconds < 60) return `every ${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return 'every minute';
  return `every ${minutes} minutes`;
}

export function MonitorDetail() {
  const { id } = useParams<{ id: string }>();
  const monitor = useFetch(() => api.getMonitor(id!), [id]);
  const events = useFetch(() => api.getEvents({ monitor_id: id!, limit: '50' }), [id]);

  const m = monitor.data?.monitor;
  const eventList = events.data?.events ?? [];

  if (monitor.loading) return <p className="text-brown text-sm">Loading health check details...</p>;
  if (!m) return <p className="text-brown text-sm">Health check not found</p>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link to="/monitors" className="link-brand text-xs">&larr; Back to Health Checks</Link>
        <h1 className="pixel-heading text-brown-darker mt-3 break-all" style={{ fontSize: 'clamp(0.7rem, 1.5vw, 0.9rem)' }}>{m.url}</h1>
        <p className="text-sm text-brown mt-1">ScanWarp checks this URL {friendlyInterval(m.check_interval_seconds)} to make sure it's responding.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="text-xs text-brown font-medium">Current Status</p>
          <div className="mt-2"><Badge label={m.status} /></div>
        </div>
        <div className="stat-card">
          <p className="text-xs text-brown font-medium">Check Frequency</p>
          <p className="text-lg font-bold mt-1 text-brown-darker">{friendlyInterval(m.check_interval_seconds)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-brown font-medium">Last Checked</p>
          <p className="text-sm mt-1.5 text-brown-dark">{m.last_checked_at ? timeAgo(m.last_checked_at) : 'not checked yet'}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-brown font-medium">Total Events</p>
          <p className="text-lg font-bold mt-1 text-accent-orange">{eventList.length}</p>
        </div>
      </div>

      {/* Response time chart */}
      {eventList.length > 0 && (
        <section>
          <div className="mb-3">
            <h2 className="section-title">Response Speed</h2>
            <p className="text-xs text-brown mt-0.5">How fast this service is responding — taller bars mean slower responses</p>
          </div>
          <div className="card p-5">
            <ResponseBars events={eventList} />
          </div>
        </section>
      )}

      {/* Events */}
      <section>
        <div className="mb-3">
          <h2 className="section-title">Recent Activity</h2>
          <p className="text-xs text-brown mt-0.5">What's been happening with this service</p>
        </div>
        <div className="card divide-y divide-sand-dark">
          {eventList.length === 0 ? (
            <p className="p-5 text-brown text-sm text-center">No activity yet — check back after the first health check runs.</p>
          ) : (
            eventList.slice(0, 20).map((e) => (
              <div key={e.id} className="p-4 flex items-start gap-3 hover:bg-sand-dark/30 transition-colors">
                <Badge label={e.type} />
                <div className="min-w-0">
                  <p className="text-sm truncate">{e.message}</p>
                  <p className="text-xs text-brown mt-1">{timeAgo(e.created_at)}</p>
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

  if (points.length === 0) return <p className="text-brown text-sm">No response time data available yet</p>;

  const maxMs = Math.max(...points.map((p) => p.ms), 1);

  return (
    <div className="flex items-end gap-1 h-28">
      {points.map((p, i) => (
        <div
          key={i}
          className="flex-1 bg-accent-orange/50 hover:bg-accent-glow/60 transition-colors cursor-default"
          style={{ height: `${(p.ms / maxMs) * 100}%` }}
          title={`${p.ms}ms at ${new Date(p.time).toLocaleTimeString()}`}
        />
      ))}
    </div>
  );
}
