import { NavLink, Outlet } from 'react-router-dom';

const links = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/monitors', label: 'Health Checks', icon: HeartPulseIcon },
  { to: '/events', label: 'Activity', icon: ActivityIcon },
  { to: '/incidents', label: 'Issues', icon: AlertIcon },
  { to: '/traces', label: 'Traces', icon: RouteIcon },
];

export function Layout() {
  return (
    <div className="min-h-screen bg-surface text-gray-100">
      <nav className="border-b border-[#1e2333] bg-surface/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center h-16 gap-1">
          {/* Brand */}
          <NavLink to="/" className="flex items-center gap-2.5 mr-8 group">
            <ScanWarpLogo />
            <div className="flex flex-col">
              <span className="font-bold text-base text-white tracking-tight leading-none">
                Scan<span className="text-brand-400">Warp</span>
              </span>
              <span className="text-[10px] text-gray-500 leading-none mt-0.5 hidden sm:block">
                app monitoring
              </span>
            </div>
          </NavLink>

          {/* Nav */}
          <div className="flex items-center gap-1">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                className={({ isActive }) =>
                  `nav-link ${isActive ? 'nav-link-active' : 'nav-link-inactive'}`
                }
              >
                <l.icon />
                <span className="hidden sm:inline">{l.label}</span>
              </NavLink>
            ))}
          </div>

          {/* Status indicator */}
          <div className="ml-auto flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-scan-pulse" />
            <span className="text-xs text-gray-500 hidden md:inline">Scanning</span>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

/* ── SVG Brand Mark ── */
function ScanWarpLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <circle cx="16" cy="16" r="14" stroke="#28b5ff" strokeWidth="1.5" strokeOpacity="0.3" />
      <circle cx="16" cy="16" r="10" stroke="#28b5ff" strokeWidth="1.5" strokeOpacity="0.5" />
      <circle cx="16" cy="16" r="6" stroke="#28b5ff" strokeWidth="1.5" strokeOpacity="0.8" />
      <circle cx="16" cy="16" r="2.5" fill="#28b5ff" />
      <line x1="16" y1="16" x2="16" y2="2" stroke="#28b5ff" strokeWidth="1.5" strokeLinecap="round" className="origin-center animate-spin" style={{ animationDuration: '4s' }} />
      <path d="M 6 16 Q 10 10, 16 6" stroke="#50d0ff" strokeWidth="1" strokeOpacity="0.4" fill="none" />
      <path d="M 26 16 Q 22 22, 16 26" stroke="#50d0ff" strokeWidth="1" strokeOpacity="0.4" fill="none" />
    </svg>
  );
}

/* ── Nav Icons ── */
function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6.5L8 2l6 4.5V13a1 1 0 01-1 1H3a1 1 0 01-1-1V6.5z" />
      <path d="M6 14V9h4v5" />
    </svg>
  );
}

function HeartPulseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 8h3l1.5-3 3 6L10 8h5" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 8H12L10 14L6 2L4 8H2" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3" />
      <circle cx="8" cy="11" r="0.5" fill="currentColor" />
    </svg>
  );
}

function RouteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12h4a2 2 0 002-2V6a2 2 0 012-2h4" />
      <circle cx="13" cy="4" r="1.5" />
      <circle cx="3" cy="12" r="1.5" />
    </svg>
  );
}
