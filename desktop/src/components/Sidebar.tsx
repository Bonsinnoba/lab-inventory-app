import { Box, ChevronDown, DollarSign, FileBarChart, Layers, LogOut, PanelLeftClose, PanelLeftOpen, ScanLine, Sun, User, Users, BookOpen, Settings, LayoutDashboard } from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import ScanLookupModal from './ScanLookupModal';

const primaryItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
  { icon: Layers, label: 'Projects', path: '/projects' },
  { icon: BookOpen, label: 'Notebook', path: '/notebook' },
  { icon: Users, label: 'Collaboration', path: '/collaboration' },
  { icon: DollarSign, label: 'Financials', path: '/financials' },
  { icon: FileBarChart, label: 'Reports', path: '/reports' },
];

const groups = [
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen, children: [{ label: 'Overview', path: '/knowledge' }, { label: 'Resources', path: '/resources' }] },
  { id: 'laboratory', label: 'Laboratory', icon: Box, children: [{ label: 'Inventory', path: '/inventory' }, { label: 'Operations', path: '/operations' }, { label: 'Intelligence', path: '/lab-intelligence' }] },
];

interface SidebarProps { user?: { username: string; display_name?: string | null; role: string } | null; onLogout?: () => void; }
const MIN_WIDTH = 200, MAX_WIDTH = 400, DEFAULT_WIDTH = 256, COLLAPSED_WIDTH = 76, WIDTH_KEY = 'labos-sidebar-width', COLLAPSED_KEY = 'labos-sidebar-collapsed';

export default function Sidebar({ user, onLogout }: SidebarProps) {
  const { theme, setMode } = useTheme();
  const [showScanModal, setShowScanModal] = useState(false);
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === 'true');
  const [width, setWidth] = useState(() => { const stored = Number(localStorage.getItem(WIDTH_KEY)); return Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH ? stored : DEFAULT_WIDTH; });
  const [isResizing, setIsResizing] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ knowledge: true, laboratory: true });

  useEffect(() => { localStorage.setItem(WIDTH_KEY, String(width)); }, [width]);
  useEffect(() => { localStorage.setItem(COLLAPSED_KEY, String(collapsed)); }, [collapsed]);
  useEffect(() => { setOpenGroups((current) => { const next = { ...current }; groups.forEach(g => { if (g.children.some(c => location.pathname.startsWith(c.path))) next[g.id] = true; }); return next; }); }, [location.pathname]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); if (collapsed) return;
    setIsResizing(true); const startX = e.clientX, startWidth = width;
    const onMove = (m: MouseEvent) => setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + m.clientX - startX)));
    const onUp = () => { setIsResizing(false); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  }, [width, collapsed]);

  const renderLink = (item: { icon?: any; label: string; path: string }, compact = false) => {
    const Icon = item.icon; const active = location.pathname.startsWith(item.path);
    return <Link key={item.path} to={item.path} aria-current={active ? 'page' : undefined} title={collapsed ? item.label : undefined} className={`desktop-nav-link w-full flex items-center gap-3 ${compact ? 'pl-11 pr-3' : 'px-3'} py-2 rounded-sm text-left transition-colors ${active ? 'is-active bg-accent text-bg' : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary'}`}>
      {Icon && <Icon size={20} />}<span className="text-sm sidebar-nav-label">{item.label}</span>
    </Link>;
  };

  return <>
    {showScanModal && <ScanLookupModal onClose={() => setShowScanModal(false)} />}
    <div style={{ width: collapsed ? COLLAPSED_WIDTH : width }} className={`desktop-sidebar relative bg-surface border-r border-border flex flex-col flex-shrink-0 ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div onMouseDown={handleMouseDown} onDoubleClick={() => { setCollapsed(false); setWidth(DEFAULT_WIDTH); }} className="absolute right-0 top-0 bottom-0 w-1.5 -mr-0.5 cursor-col-resize z-10 group"><div className={`h-full w-full transition-colors ${isResizing ? 'bg-accent' : 'bg-transparent group-hover:bg-accent/50'}`} /></div>
      <div className="p-3 border-b border-border sidebar-brand-row"><div className="min-w-0"><div className="labos-brand">LAB<span>OS</span></div><div className="text-[10px] text-text-secondary font-mono mt-1 tracking-wider sidebar-brand-subtitle">LABORATORY OPERATING SYSTEM</div></div><button type="button" onClick={() => setCollapsed(v => !v)} className="sidebar-collapse-button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <PanelLeftOpen size={17}/> : <PanelLeftClose size={17}/>}</button></div>
      <nav className="flex-1 p-2 overflow-y-auto sidebar-nav">
        {primaryItems.map((item) => renderLink(item))}
        {groups.map(group => { const Icon = group.icon; const active = group.children.some(c => location.pathname.startsWith(c.path)); return <div key={group.id} className="mt-1">
          <button type="button" onClick={() => setOpenGroups(current => ({ ...current, [group.id]: !current[group.id] }))} title={collapsed ? group.label : undefined} className={`w-full flex items-center gap-3 px-3 py-2 rounded-sm text-left transition-colors ${active ? 'text-text-primary' : 'text-text-secondary'} hover:bg-surface-raised hover:text-text-primary`}>
            <Icon size={20}/><span className="text-sm sidebar-nav-label flex-1">{group.label}</span>{!collapsed && <ChevronDown size={15} className={`transition-transform ${openGroups[group.id] ? '' : '-rotate-90'}`} />}
          </button>
          {!collapsed && openGroups[group.id] && group.children.map(child => renderLink(child, true))}
        </div>; })}
        {user?.role === 'admin' && renderLink({ icon: User, label: 'Users', path: '/users' })}
        <button onClick={() => setShowScanModal(true)} title={collapsed ? 'Scan Item' : undefined} className="w-full flex items-center gap-3 px-3 py-2 rounded-sm text-left transition-colors text-text-secondary hover:bg-surface-raised hover:text-text-primary mt-1 border-t border-border pt-3"><ScanLine size={20}/><span className="text-sm sidebar-nav-label">Scan Item</span></button>
      </nav>
      {user && <div className="p-3 border-t border-border sidebar-user-area"><div className="flex items-center gap-3 mb-3"><div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center"><User size={16} className="text-bg"/></div><div className="flex-1 min-w-0"><p className="text-text-primary text-sm font-medium truncate sidebar-user-name">{user.display_name || user.username}</p><p className="text-text-secondary text-xs capitalize sidebar-user-role">{user.role}</p></div></div><div className="flex gap-2 sidebar-user-actions"><button onClick={() => setMode(theme.mode === 'light' ? 'dark' : 'light')} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-raised border border-border rounded-sm text-text-secondary hover:text-text-primary hover:border-accent transition-colors text-sm">{theme.mode === 'light' ? <Sun size={16}/> : <Sun size={16}/>}</button><Link to="/settings" className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-raised border border-border rounded-sm text-text-secondary hover:text-text-primary hover:border-accent transition-colors text-sm"><Settings size={16}/></Link>{onLogout && <button onClick={onLogout} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-raised border border-border rounded-sm text-text-secondary hover:text-text-primary hover:border-accent transition-colors text-sm"><LogOut size={16}/></button>}</div></div>}
    </div>
  </>;
}
