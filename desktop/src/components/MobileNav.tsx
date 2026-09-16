import { Box, Folder, Home, Layers, Search, BookOpen, Users } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

const items = [
  { label: 'Home', path: '/dashboard', icon: Home },
  { label: 'Stock', path: '/inventory', icon: Box },
  { label: 'Projects', path: '/projects', icon: Layers },
  { label: 'Knowledge', path: '/knowledge', icon: BookOpen },
  { label: 'Resources', path: '/resources', icon: Folder },
  { label: 'Search', path: '/search', icon: Search },
  { label: 'Team', path: '/collaboration', icon: Users },
];

export default function MobileNav() {
  const location = useLocation();
  return (
    <nav className="mobile-bottom-nav" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }} aria-label="Primary navigation">
      {items.map(({ label, path, icon: Icon }) => {
        const active = location.pathname.startsWith(path);
        return (
          <Link key={path} to={path} aria-current={active ? 'page' : undefined} className={active ? 'mobile-nav-item active' : 'mobile-nav-item'}>
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
