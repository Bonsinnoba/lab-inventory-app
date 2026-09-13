import {
  Box,
  ChevronDown,
  DollarSign,
  FileBarChart,
  Layers,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ScanLine,
  Sun,
  User,
  Users,
  BookOpen,
  Settings,
  LayoutDashboard,
  Download,
} from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import ScanLookupModal from './ScanLookupModal';

const primaryItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
  { icon: Layers, label: 'Projects', path: '/projects' },
  { icon: BookOpen, label: 'Notebook', path: '/notebook' },
  { icon: Download, label: 'Downloads', path: '/downloads' },
  { icon: Users, label: 'Collaboration', path: '/collaboration' },
  { icon: DollarSign, label: 'Financials', path: '/financials' },
  { icon: FileBarChart, label: 'Reports', path: '/reports' },
];

const groups = [
  {
    id: 'knowledge',
    label: 'Knowledge',
    icon: BookOpen,
    children: [
      { label: 'Overview', path: '/knowledge' },
      { label: 'Resources', path: '/resources' },
    ],
  },
  {
    id: 'laboratory',
    label: 'Laboratory',
    icon: Box,
    children: [
      { label: 'Inventory', path: '/inventory' },
      { label: 'Operations', path: '/operations' },
      { label: 'Intelligence', path: '/lab-intelligence' },
    ],
  },
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
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === 'true',
  );
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH
      ? saved
      : DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    knowledge: true,
    laboratory: true,
  });

  useEffect(() => {
    localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    setOpenGroups((current) => {
      const next = { ...current };
      groups.forEach((group) => {
        if (group.children.some((item) => location.pathname.startsWith(item.path))) {
          next[group.id] = true;
        }
      });
      return next;
    });
  }, [location.pathname]);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      if (collapsed) return;

      setIsResizing(true);
      const startX = event.clientX;
      const startWidth = width;

      const move = (moveEvent: MouseEvent) => {
        setWidth(
          Math.min(
            MAX_WIDTH,
            Math.max(MIN_WIDTH, startWidth + moveEvent.clientX - startX),
          ),
        );
      };

      const up = () => {
        setIsResizing(false);
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };

      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [width, collapsed],
  );

  const renderLink = (
    item: { icon?: typeof User; label: string; path: string },
    compact = false,
  ) => {
    const Icon = item.icon;
    const active = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);

    return (
      <Link
        key={item.path}
        to={item.path}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
        className={`desktop-nav-link w-full flex items-center gap-3 ${
          compact ? 'pl-11 pr-3' : 'px-3'
        } py-2 rounded-md text-left transition-colors ${
          active
            ? 'is-active bg-accent text-bg'
            : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary'
        }`}
      >
        {Icon && <Icon size={19} aria-hidden="true" />}
        <span className="text-sm sidebar-nav-label">{item.label}</span>
      </Link>
    );
  };

  return (
    <>
      {showScanModal && <ScanLookupModal onClose={() => setShowScanModal(false)} />}

      <aside
        style={{ width: collapsed ? COLLAPSED_WIDTH : width }}
        aria-label="LabOS navigation"
        className={`desktop-sidebar relative bg-surface border-r border-border flex flex-col flex-shrink-0 ${
          collapsed ? 'sidebar-collapsed' : ''
        }`}
      >
        <div
          onMouseDown={handleMouseDown}
          onDoubleClick={() => {
            setCollapsed(false);
            setWidth(DEFAULT_WIDTH);
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          className="absolute right-0 top-0 bottom-0 w-1.5 -mr-0.5 cursor-col-resize z-10 group"
        >
          <div
            className={`h-full w-full transition-colors ${
              isResizing ? 'bg-accent' : 'bg-transparent group-hover:bg-accent/50'
            }`}
          />
        </div>

        <div className="p-3 border-b border-border sidebar-brand-row">
          <div className="min-w-0">
            <div className="labos-brand" aria-label="LabOS">LAB<span>OS</span></div>
            <div className="text-[10px] text-text-secondary font-mono mt-1 tracking-wider sidebar-brand-subtitle">
              LABORATORY OPERATING SYSTEM
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="sidebar-collapse-button"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>

        <nav className="flex-1 p-2 overflow-y-auto sidebar-nav">
          {primaryItems.map((item) => renderLink(item))}

          <div className="sidebar-section-divider" aria-hidden="true" />

          {groups.map((group) => {
            const Icon = group.icon;
            const active = group.children.some((child) =>
              location.pathname === child.path || location.pathname.startsWith(`${child.path}/`),
            );

            return (
              <div key={group.id} className="mt-1">
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroups((current) => ({
                      ...current,
                      [group.id]: !current[group.id],
                    }))
                  }
                  title={collapsed ? group.label : undefined}
                  aria-label={collapsed ? group.label : undefined}
                  aria-expanded={collapsed ? undefined : openGroups[group.id]}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                    active ? 'text-text-primary' : 'text-text-secondary'
                  } hover:bg-surface-raised hover:text-text-primary`}
                >
                  <Icon size={19} aria-hidden="true" />
                  <span className="text-sm sidebar-nav-label flex-1">{group.label}</span>
                  {!collapsed && (
                    <ChevronDown
                      size={15}
                      className={`transition-transform ${
                        openGroups[group.id] ? '' : '-rotate-90'
                      }`}
                      aria-hidden="true"
                    />
                  )}
                </button>

                {!collapsed &&
                  openGroups[group.id] &&
                  group.children.map((child) => renderLink(child, true))}
              </div>
            );
          })}

          {user?.role === 'admin' && renderLink({ icon: User, label: 'Users', path: '/users' })}

          <button
            type="button"
            onClick={() => setShowScanModal(true)}
            title={collapsed ? 'Scan Item' : undefined}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors text-text-secondary hover:bg-surface-raised hover:text-text-primary mt-2 border-t border-border pt-3"
          >
            <ScanLine size={19} aria-hidden="true" />
            <span className="text-sm sidebar-nav-label">Scan Item</span>
          </button>
        </nav>

        {user && (
          <div className="p-3 border-t border-border sidebar-user-area">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center flex-shrink-0">
                <User size={16} className="text-bg" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-text-primary text-sm font-medium truncate sidebar-user-name">
                  {user.display_name || user.username}
                </p>
                <p className="text-text-secondary text-xs capitalize sidebar-user-role">
                  {user.role}
                </p>
              </div>
            </div>

            <div className="flex gap-2 sidebar-user-actions">
              <button
                type="button"
                onClick={() => setMode(theme.mode === 'light' ? 'dark' : 'light')}
                title={`Switch to ${theme.mode === 'light' ? 'dark' : 'light'} mode`}
                aria-label={`Switch to ${theme.mode === 'light' ? 'dark' : 'light'} mode`}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-raised border border-border rounded-md text-text-secondary hover:text-text-primary hover:border-accent transition-colors text-sm"
              >
                <Sun size={16} aria-hidden="true" />
              </button>
              <Link
                to="/settings"
                title="Settings"
                aria-label="Settings"
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-raised border border-border rounded-md text-text-secondary hover:text-text-primary hover:border-accent transition-colors text-sm"
              >
                <Settings size={16} aria-hidden="true" />
              </Link>
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  title="Sign out"
                  aria-label="Sign out"
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-raised border border-border rounded-md text-text-secondary hover:text-text-primary hover:border-accent transition-colors text-sm"
                >
                  <LogOut size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
