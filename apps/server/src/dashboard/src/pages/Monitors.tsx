import { Link } from 'react-router-dom';
import { api } from '../api';
import { Badge } from '../components/Badge';
import { usePolling, timeAgo } from '../hooks';

export function Monitors() {
  const { data, loading } = usePolling(() => api.getMonitors(), 15000);
  const monitors = data?.monitors ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Monitors</h1>

      {loading && monitors.length === 0 ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : monitors.length === 0 ? (
        <p className="text-gray-500 text-sm">No monitors configured. Use <code className="text-gray-400">scanwarp init</code> to add monitors.</p>
      ) : (
        <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wide">
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">URL</th>
                <th className="text-left p-3 font-medium hidden sm:table-cell">Interval</th>
                <th className="text-left p-3 font-medium">Last Check</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {monitors.map((m) => (
                <tr key={m.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="p-3">
                    <Badge label={m.status} />
                  </td>
                  <td className="p-3">
                    <Link to={`/monitors/${m.id}`} className="text-blue-400 hover:underline truncate block max-w-md">
                      {m.url}
                    </Link>
                  </td>
                  <td className="p-3 text-gray-400 hidden sm:table-cell">{m.check_interval_seconds}s</td>
                  <td className="p-3 text-gray-500">
                    {m.last_checked_at ? timeAgo(m.last_checked_at) : 'never'}
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
