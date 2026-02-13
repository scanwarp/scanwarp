import { Link } from 'react-router-dom';
import { api } from '../api';
import { Badge } from '../components/Badge';
import { usePolling, timeAgo } from '../hooks';

export function Overview() {
  const monitors = usePolling(() => api.getMonitors(), 15000);
  const incidents = usePolling(() => api.getIncidents({ status: 'open' }), 15000);
  const events = usePolling(() => api.getEvents({ limit: '50' }), 15000);

  const monitorList = monitors.data?.monitors ?? [];
  const incidentList = incidents.data?.incidents ?? [];
  const eventList = events.data?.events ?? [];

  const healthyCount = monitorList.filter((m) => m.status === 'up').length;
  const downCount = monitorList.filter((m) => m.status === 'down').length;
  const errorEvents = eventList.filter(
    (e) => e.severity === 'critical' || e.severity === 'high',
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Overview</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Monitors Healthy" value={healthyCount} color="text-green-400" />
        <StatCard label="Monitors Down" value={downCount} color={downCount > 0 ? 'text-red-400' : 'text-gray-400'} />
        <StatCard label="Open Incidents" value={incidentList.length} color={incidentList.length > 0 ? 'text-red-400' : 'text-gray-400'} />
        <StatCard label="Recent Events" value={eventList.length} color="text-blue-400" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Open Incidents */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-300">Open Incidents</h2>
            <Link to="/incidents" className="text-xs text-blue-400 hover:underline">View all</Link>
          </div>
          <div className="bg-gray-900 rounded-lg border border-gray-800 divide-y divide-gray-800">
            {incidentList.length === 0 ? (
              <p className="p-4 text-gray-500 text-sm">No open incidents</p>
            ) : (
              incidentList.slice(0, 5).map((inc) => (
                <Link
                  key={inc.id}
                  to={`/incidents/${inc.id}`}
                  className="flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Badge label={inc.severity} />
                    <span className="text-sm truncate max-w-xs">
                      {inc.diagnosis_text?.slice(0, 80) || `Incident with ${inc.events.length} event(s)`}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500 shrink-0">{timeAgo(inc.created_at)}</span>
                </Link>
              ))
            )}
          </div>
        </section>

        {/* Monitors */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-300">Monitors</h2>
            <Link to="/monitors" className="text-xs text-blue-400 hover:underline">View all</Link>
          </div>
          <div className="bg-gray-900 rounded-lg border border-gray-800 divide-y divide-gray-800">
            {monitorList.length === 0 ? (
              <p className="p-4 text-gray-500 text-sm">No monitors configured</p>
            ) : (
              monitorList.map((m) => (
                <Link
                  key={m.id}
                  to={`/monitors/${m.id}`}
                  className="flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        m.status === 'up'
                          ? 'bg-green-400'
                          : m.status === 'down'
                          ? 'bg-red-400'
                          : 'bg-gray-500'
                      }`}
                    />
                    <span className="text-sm truncate max-w-xs">{m.url}</span>
                  </div>
                  <span className="text-xs text-gray-500 shrink-0">
                    {m.last_checked_at ? timeAgo(m.last_checked_at) : 'never'}
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Recent errors */}
      {errorEvents.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-300">Recent Errors</h2>
            <Link to="/events" className="text-xs text-blue-400 hover:underline">View all</Link>
          </div>
          <div className="bg-gray-900 rounded-lg border border-gray-800 divide-y divide-gray-800">
            {errorEvents.slice(0, 5).map((e) => (
              <div key={e.id} className="p-3 flex items-start gap-2">
                <Badge label={e.type} />
                <div className="min-w-0">
                  <p className="text-sm truncate">{e.message}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{e.source} &middot; {timeAgo(e.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}
