import { Box, DollarSign, FileText, Folder, Layers, LogOut, Settings, X, LayoutDashboard, ScanLine, Search, Bot, User, Calculator, FileBarChart, BellRing } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useState } from 'react';
import ScanLookupModal from './ScanLookupModal';

interface Props {
  open: boolean;
  onClose: () => void;
  user?: { username: string; display_name?: string | null; role: string } | null;
  onLogout?: () => void;
}

const items = [
  [LayoutDashboard, 'Dashboard', '/dashboard'],
  [Box, 'Inventory', '/inventory'],
  [Layers, 'Projects', '/projects'],
  [FileText, 'Notebook', '/notebook'],
  [Folder, 'Resources', '/resources'],
  [DollarSign, 'Financials', '/financials'],
  [Search, 'Search', '/search'],
  [Bot, 'Lab Assistant', '/assistant'],
  [Calculator, 'Engineering Tools', '/engineering'],
  [FileBarChart, 'Reports', '/reports'],
  [BellRing, 'Automation', '/automation'],
] as const;

export default function MobileDrawer({ open, onClose, user, onLogout }: Props) {
  const location = useLocation();
  const { theme, setMode } = useTheme();
  const [scan, setScan] = useState(false);
  if (!open) return null;

  return (
    <>
      <div className="mobile-drawer-backdrop" onClick={onClose} />
      <aside className="mobile-drawer" aria-label="Navigation drawer">
        <div className="mobile-drawer-head">
          <div><strong>LABOS</strong><span>Laboratory workspace</span></div>
          <button className="mobile-icon-button" onClick={onClose} aria-label="Close navigation"><X size={20} /></button>
        </div>
        <nav className="mobile-drawer-links">
          {items.map(([Icon, label, path]) => {
            const ActiveIcon = Icon as any;
            const active = location.pathname.startsWith(path);
            return <Link key={path} to={path} onClick={onClose} className={active ? 'mobile-drawer-link active' : 'mobile-drawer-link'}><ActiveIcon size={19} /><span>{label}</span></Link>;
          })}
          {user?.role === 'admin' && <Link to="/users" onClick={onClose} className={location.pathname.startsWith('/users') ? 'mobile-drawer-link active' : 'mobile-drawer-link'}><User size={19} /><span>Users</span></Link>}
          <button className="mobile-drawer-link" onClick={() => setScan(true)}><ScanLine size={19} /><span>Scan Item</span></button>
        </nav>
        {user && <div className="mobile-drawer-footer">
          <div className="mobile-user"><div className="mobile-user-avatar">{user.username.slice(0, 1).toUpperCase()}</div><div><strong>{user.display_name || user.username}</strong><span>{user.role}</span></div></div>
          <div className="mobile-drawer-actions">
            <button onClick={() => setMode(theme.mode === 'light' ? 'dark' : 'light')}>{theme.mode === 'light' ? 'Dark mode' : 'Light mode'}</button>
            <Link to="/settings" onClick={onClose}><Settings size={16} /> Settings</Link>
            {onLogout && <button onClick={onLogout}><LogOut size={16} /> Sign out</button>}
          </div>
        </div>}
      </aside>
      {scan && <ScanLookupModal onClose={() => setScan(false)} />}
    </>
  );
}
