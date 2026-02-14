import { Link } from 'react-router-dom';
import { api } from '../api';
import { Badge } from '../components/Badge';
import { usePolling, timeAgo } from '../hooks';

function friendlyInterval(seconds: number): string {
  if (seconds < 60) return `every ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return 'every minute';
  return `every ${minutes} min`;
}

export function Monitors() {
  const { data, loading } = usePolling(() => api.getMonitors(), 15000);
  const monitors = data?.monitors ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="pixel-heading text-brown-darker" style={{ fontSize: 'clamp(0.8rem, 2vw, 1.1rem)' }}>Health Checks</h1>
        <p className="text-sm text-brown mt-1">
          ScanWarp pings these URLs regularly to make sure they're responding. If something goes down, you'll know.
        </p>
      </div>

      {loading && monitors.length === 0 ? (
        <p className="text-brown text-sm">Loading health checks...</p>
      ) : monitors.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-brown-dark">No health checks set up yet</p>
          <p className="text-xs text-brown mt-2">
            Run <code className="text-accent-orange font-mono bg-accent-orange/10 px-1.5 py-0.5">scanwarp init</code> to start monitoring your app.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-[3px] border-brown-dark text-brown text-xs uppercase tracking-wider font-pixel">
                <th className="text-left p-4 font-medium">Status</th>
                <th className="text-left p-4 font-medium">URL</th>
                <th className="text-left p-4 font-medium hidden sm:table-cell">Check Frequency</th>
                <th className="text-left p-4 font-medium">Last Checked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-dark">
              {monitors.map((m) => (
                <tr key={m.id} className="hover:bg-sand-dark/30 transition-colors">
                  <td className="p-4">
                    <Badge label={m.status} />
                  </td>
                  <td className="p-4">
                    <Link to={`/monitors/${m.id}`} className="link-brand truncate block max-w-md">
                      {m.url}
                    </Link>
                  </td>
                  <td className="p-4 text-brown-dark hidden sm:table-cell font-mono">{friendlyInterval(m.check_interval_seconds)}</td>
                  <td className="p-4 text-brown font-mono">
                    {m.last_checked_at ? timeAgo(m.last_checked_at) : 'not checked yet'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
