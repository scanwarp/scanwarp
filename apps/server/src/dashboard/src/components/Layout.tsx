import { NavLink, Outlet } from 'react-router-dom';

const links = [
  { to: '/', label: 'Overview' },
  { to: '/monitors', label: 'Monitors' },
  { to: '/events', label: 'Events' },
  { to: '/incidents', label: 'Incidents' },
  { to: '/traces', label: 'Traces' },
];

export function Layout() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center h-14 gap-1">
          <span className="font-bold text-lg mr-6 text-white tracking-tight">ScanWarp</span>
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === '/'}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
