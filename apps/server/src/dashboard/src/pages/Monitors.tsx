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
        <h1 className="text-2xl font-bold text-white">Health Checks</h1>
        <p className="text-sm text-gray-500 mt-1">
          ScanWarp pings these URLs regularly to make sure they're responding. If something goes down, you'll know.
        </p>
      </div>

      {loading && monitors.length === 0 ? (
        <p className="text-gray-500 text-sm">Loading health checks...</p>
      ) : monitors.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-400">No health checks set up yet</p>
          <p className="text-xs text-gray-600 mt-2">
            Run <code className="text-brand-400 bg-brand-500/10 px-1.5 py-0.5 rounded">scanwarp init</code> to start monitoring your app.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e2333] text-gray-500 text-xs uppercase tracking-wider">
                <th className="text-left p-4 font-medium">Status</th>
                <th className="text-left p-4 font-medium">URL</th>
                <th className="text-left p-4 font-medium hidden sm:table-cell">Check Frequency</th>
                <th className="text-left p-4 font-medium">Last Checked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2333]">
              {monitors.map((m) => (
                <tr key={m.id} className="hover:bg-surface-overlay/50 transition-colors">
                  <td className="p-4">
                    <Badge label={m.status} />
                  </td>
                  <td className="p-4">
                    <Link to={`/monitors/${m.id}`} className="link-brand truncate block max-w-md">
                      {m.url}
                    </Link>
                  </td>
                  <td className="p-4 text-gray-400 hidden sm:table-cell">{friendlyInterval(m.check_interval_seconds)}</td>
                  <td className="p-4 text-gray-500">
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
