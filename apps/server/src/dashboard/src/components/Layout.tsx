import { NavLink, Outlet } from 'react-router-dom';

const links = [
  { to: '/', label: 'Home' },
  { to: '/monitors', label: 'Health' },
  { to: '/events', label: 'Activity' },
  { to: '/incidents', label: 'Issues' },
  { to: '/traces', label: 'Traces' },
];

export function Layout() {
  return (
    <div className="min-h-screen bg-sand-light text-brown-darker">
      <nav className="border-b-[3px] border-brown-dark bg-sand-light sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center h-14 gap-1">
          {/* Brand */}
          <NavLink to="/" className="flex items-center gap-3 mr-8">
            <PixelLogo />
            <span className="font-pixel text-[0.85rem] text-brown-darker tracking-[2px]">
              SCANWARP
            </span>
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
                {l.label}
              </NavLink>
            ))}
          </div>

          {/* Status indicator */}
          <div className="ml-auto flex items-center gap-2">
            <span className="w-2 h-2 bg-accent-green animate-blink" />
            <span className="text-xs text-brown font-mono hidden md:inline">SCANNING</span>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

/* ── Pixel-art Logo Icon (matches landing page .logo-icon) ── */
function PixelLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <rect width="28" height="28" fill="#a44200" stroke="#5C4A32" strokeWidth="2" />
      <rect x="6" y="6" width="5" height="5" fill="#FAF6F0" />
      <rect x="14" y="6" width="5" height="5" fill="#FAF6F0" />
      <rect x="6" y="14" width="5" height="5" fill="#FAF6F0" />
    </svg>
  );
}
