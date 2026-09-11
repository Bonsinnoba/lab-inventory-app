import { Box, DollarSign, FileText, Search, Layers, LogOut, Users, User, Settings, Sun, Moon, Folder, ScanLine, LayoutDashboard, BookOpen, Bot, FileBarChart, BellRing, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import ScanLookupModal from './ScanLookupModal';

const menuItems = [
  { icon: LayoutDashboard, label: 'Dashboard', id: 'dashboard', path: '/dashboard' },
  { icon: Box, label: 'Inventory', id: 'inventory', path: '/inventory' },
  { icon: DollarSign, label: 'Financials', id: 'financials', path: '/financials' },
  { icon: FileText, label: 'Notebook', id: 'notebook', path: '/notebook' },
  { icon: BookOpen, label: 'Knowledge', id: 'knowledge', path: '/knowledge' },
  { icon: Folder, label: 'Resources', id: 'resources', path: '/resources' },
  { icon: Search, label: 'Search', id: 'search', path: '/search' },
  { icon: Layers, label: 'Projects', id: 'projects', path: '/projects' },
  { icon: Users, label: 'Collaboration', id: 'collaboration', path: '/collaboration' },
  { icon: Bot, label: 'Lab Assistant', id: 'assistant', path: '/assistant' },
  { icon: FileBarChart, label: 'Reports', id: 'reports', path: '/reports' },
  { icon: BellRing, label: 'Automation', id: 'automation', path: '/automation' },
];

interface SidebarProps {
  user?: { username: string; display_name?: string | null; role: string } | null;
  onLogout?: () => void;
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 256;
const COLLAPSED_WIDTH = 76;
const WIDTH_KEY = 'labos-sidebar-width';
const COLLAPSED_KEY = 'labos-sidebar-collapsed';

export default function Sidebar({ user, onLogout }: SidebarProps) {
  const { theme, setMode } = useTheme();
  const [showScanModal, setShowScanModal] = useState(false);
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === 'true');
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH ? stored : DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    localStorage.setItem(WIDTH_KEY, String(width));
  }, [width, collapsed]);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (collapsed) return;
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = width;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta)));
    };
    const onUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [width, collapsed]);

  return (
    <>
      {showScanModal && <ScanLookupModal onClose={() => setShowScanModal(false)} />}
      <div style={{ width: collapsed ? COLLAPSED_WIDTH : width }} className={`desktop-sidebar relative bg-surface border-r border-border flex flex-col flex-shrink-0 ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <div
          onMouseDown={handleMouseDown}
          onDoubleClick={() => { setCollapsed(false); setWidth(DEFAULT_WIDTH); }}
          className="absolute right-0 top-0 bottom-0 w-1.5 -mr-0.5 cursor-col-resize z-10 group"
          title="Drag to resize · double-click to reset"
        >
          <div className={`h-full w-full transition-colors ${isResizing ? 'bg-accent' : 'bg-transparent group-hover:bg-accent/50'}`} />
        </div>

        <div className="p-3 border-b border-border sidebar-brand-row">
          <div className="min-w-0">
            <div className="labos-brand">LAB<span>OS</span></div>
            <div className="text-[10px] text-text-secondary font-mono mt-1 tracking-wider sidebar-brand-subtitle">LABORATORY OPERATING SYSTEM</div>
          </div>
          <button type="button" onClick={() => setCollapsed((value) => !value)} className="sidebar-collapse-button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>
        <nav className="flex-1 p-2 overflow-y-auto sidebar-nav">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.id}
                to={item.path}
                aria-current={isActive ? 'page' : undefined}
                title={collapsed ? item.label : undefined}
                className={`desktop-nav-link w-full flex items-center gap-3 px-3 py-2 rounded-sm text-left transition-colors ${
                  isActive 
                    ? 'is-active bg-accent text-bg' 
                    : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary'
                }`}
              >
                <Icon size={20} />
                <span className="text-sm sidebar-nav-label">{item.label}</span>
              </Link>
            );
          })}
          {user?.role === 'admin' && (
            <Link
              to="/users"
              aria-current={location.pathname.startsWith('/users') ? 'page' : undefined}
              title={collapsed ? 'Users' : undefined}
              className={`desktop-nav-link w-full flex items-center gap-3 px-3 py-2 rounded-sm text-left transition-colors ${location.pathname.startsWith('/users') ? 'is-active bg-accent text-bg' : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary'}`}
            >
              <User size={20} />
              <span className="text-sm sidebar-nav-label">Users</span>
            </Link>
          )}
          <button
            onClick={() => setShowScanModal(true)}
            title={collapsed ? 'Scan Item' : undefined}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-sm text-left transition-colors text-text-secondary hover:bg-surface-raised hover:text-text-primary mt-1 border-t border-border pt-3"
          >
            <ScanLine size={20} />
            <span className="text-sm sidebar-nav-label">Scan Item</span>
          </button>
        </nav>
        {user && (
          <div className="p-3 border-t border-border sidebar-user-area">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center">
                <User size={16} className="text-bg" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-text-primary text-sm font-medium truncate sidebar-user-name">{user.display_name || user.username}</p>
                <p className="text-text-secondary text-xs capitalize sidebar-user-role">{user.role}</p>
              </div>
            </div>
            <div className="flex gap-2 sidebar-user-actions">
              <button
                onClick={() => setMode(theme.mode === 'light' ? 'dark' : 'light')}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-raised border border-border rounded-sm text-text-secondary hover:text-text-primary hover:border-accent transition-colors text-sm"
                title={theme.mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              >
                {theme.mode === 'light' ? <Moon size={16} /> : <Sun size={16} />}
              </button>
              <Link
                to="/settings"
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-raised border border-border rounded-sm text-text-secondary hover:text-text-primary hover:border-accent transition-colors text-sm"
                title="Settings"
              >
                <Settings size={16} />
              </Link>
              {onLogout && (
                <button
                  onClick={onLogout}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-raised border border-border rounded-sm text-text-secondary hover:text-text-primary hover:border-accent transition-colors text-sm"
                  title="Logout"
                >
                  <LogOut size={16} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
