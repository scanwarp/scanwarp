import { Link } from 'react-router-dom';
import { api } from '../api';
import { Badge } from '../components/Badge';
import { usePolling, timeAgo } from '../hooks';

/* Plain-English source names */
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

function friendlySource(source: string) {
  return sourceLabels[source] || source;
}

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

  /* Overall health summary */
  const allGood = downCount === 0 && incidentList.length === 0 && errorEvents.length === 0;

  return (
    <div className="space-y-8">
      {/* Hero / Status Banner */}
      <div className={`card p-6 ${allGood ? 'border-accent-green' : 'border-accent-red'}`}>
        <h1 className="pixel-heading text-brown-darker" style={{ fontSize: 'clamp(0.8rem, 2vw, 1.1rem)' }}>
          {allGood ? 'Everything looks good.' : 'Heads up — some things need attention.'}
        </h1>
        <p className="text-brown mt-2 text-sm">
          {allGood
            ? 'All your services are running smoothly. ScanWarp is keeping watch.'
            : `ScanWarp found ${downCount > 0 ? `${downCount} service${downCount > 1 ? 's' : ''} offline` : ''}${downCount > 0 && incidentList.length > 0 ? ' and ' : ''}${incidentList.length > 0 ? `${incidentList.length} issue${incidentList.length > 1 ? 's' : ''} to look at` : ''}.`
          }
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Services Online" hint="How many of your sites/APIs are responding" value={healthyCount} color="text-accent-green" />
        <StatCard label="Services Offline" hint="Sites or APIs that aren't responding" value={downCount} color={downCount > 0 ? 'text-accent-red' : 'text-brown'} />
        <StatCard label="Open Issues" hint="Problems that haven't been fixed yet" value={incidentList.length} color={incidentList.length > 0 ? 'text-accent-red' : 'text-brown'} />
        <StatCard label="Recent Activity" hint="Things that happened recently" value={eventList.length} color="text-accent-orange" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Open Issues */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="section-title">Open Issues</h2>
              <p className="text-xs text-brown mt-1">Problems ScanWarp detected that need your attention</p>
            </div>
            <Link to="/incidents" className="link-brand text-xs">View all</Link>
          </div>
          <div className="card divide-y divide-sand-dark">
            {incidentList.length === 0 ? (
              <div className="p-5 text-center">
                <p className="text-brown text-sm">No open issues — you're in the clear!</p>
              </div>
            ) : (
              incidentList.slice(0, 5).map((inc) => (
                <Link key={inc.id} to={`/incidents/${inc.id}`} className="flex items-center justify-between p-4 hover:bg-sand-dark/30 transition-colors">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Badge label={inc.severity} />
                    <span className="text-sm truncate">{inc.diagnosis_text?.slice(0, 80) || `Issue with ${inc.events.length} related event${inc.events.length > 1 ? 's' : ''}`}</span>
                  </div>
                  <span className="text-xs text-brown shrink-0 ml-3 font-mono">{timeAgo(inc.created_at)}</span>
                </Link>
              ))
            )}
          </div>
        </section>

        {/* Service Health */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="section-title">Service Health</h2>
              <p className="text-xs text-brown mt-1">Sites and APIs that ScanWarp is checking on</p>
            </div>
            <Link to="/monitors" className="link-brand text-xs">View all</Link>
          </div>
          <div className="card divide-y divide-sand-dark">
            {monitorList.length === 0 ? (
              <div className="p-5 text-center">
                <p className="text-brown text-sm">No health checks set up yet.</p>
                <p className="text-xs text-brown mt-1">Run <code className="text-accent-orange font-mono bg-accent-orange/10 px-1.5 py-0.5">scanwarp init</code> to get started.</p>
              </div>
            ) : (
              monitorList.map((m) => (
                <Link key={m.id} to={`/monitors/${m.id}`} className="flex items-center justify-between p-4 hover:bg-sand-dark/30 transition-colors">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`w-2 h-2 shrink-0 ${
                        m.status === 'up' ? 'bg-accent-green' : m.status === 'down' ? 'bg-accent-red animate-blink' : 'bg-sand-dark'
                      }`}
                      title={m.status === 'up' ? 'Responding normally' : m.status === 'down' ? 'Not responding' : 'Haven\'t checked yet'}
                    />
                    <span className="text-sm font-mono truncate">{m.url}</span>
                  </div>
                  <span className="text-xs text-brown shrink-0 ml-3 font-mono">{m.last_checked_at ? `checked ${timeAgo(m.last_checked_at)}` : 'not checked yet'}</span>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Recent problems */}
      {errorEvents.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="section-title">Recent Problems</h2>
              <p className="text-xs text-brown mt-1">High-priority errors ScanWarp caught recently</p>
            </div>
            <Link to="/events" className="link-brand text-xs">View all activity</Link>
          </div>
          <div className="card divide-y divide-sand-dark">
            {errorEvents.slice(0, 5).map((e) => (
              <div key={e.id} className="p-4 flex items-start gap-3">
                <Badge label={e.type} />
                <div className="min-w-0">
                  <p className="text-sm">{e.message}</p>
                  <p className="text-xs text-brown mt-1">from <span className="text-brown-dark font-mono">{friendlySource(e.source)}</span> · {timeAgo(e.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, hint, value, color }: { label: string; hint: string; value: number; color: string }) {
  return (
    <div className="stat-card" title={hint}>
      <p className="text-xs text-brown font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1.5 ${color}`}>{value}</p>
      <p className="text-[11px] text-brown mt-1">{hint}</p>
    </div>
  );
}
