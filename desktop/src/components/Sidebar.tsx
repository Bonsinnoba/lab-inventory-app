import { Box, Brain, ChevronDown, DollarSign, FileBarChart, Layers, LogOut, Microscope, PanelLeftClose, PanelLeftOpen, Sun, User, Users, BookOpen, Settings, LayoutDashboard, Download, Moon, Library } from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';

const primaryItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' }, { icon: Layers, label: 'Projects', path: '/projects' }, { icon: BookOpen, label: 'Notebook', path: '/notebook' }, { icon: Download, label: 'Downloads', path: '/downloads' }, { icon: Users, label: 'Collaboration', path: '/collaboration' }, { icon: DollarSign, label: 'Financials', path: '/financials' }, { icon: FileBarChart, label: 'Reports', path: '/reports' },
];
const standaloneItems = [
  { icon: Brain, label: 'Knowledge', path: '/knowledge' },
  { icon: Library, label: 'Resources', path: '/resources' },
  { icon: Box, label: 'Inventory', path: '/inventory' },
];
const groups = [
  { id: 'laboratory', label: 'Laboratory', icon: Microscope, children: [{ label: 'Operations', path: '/operations' }, { label: 'Intelligence', path: '/lab-intelligence' }] },
];
interface SidebarProps { user?: { username: string; display_name?: string | null; role: string } | null; permissions?: string[]; onLogout?: () => void; }
const MIN_WIDTH = 200, MAX_WIDTH = 400, DEFAULT_WIDTH = 256, COLLAPSED_WIDTH = 76;
const WIDTH_KEY = 'labos-sidebar-width', COLLAPSED_KEY = 'labos-sidebar-collapsed';
type TooltipState = { label: string; top: number; left: number } | null;

export default function Sidebar({ user, permissions = [], onLogout }: SidebarProps) {
  const { theme, setMode } = useTheme();
  const [showCollapsedProfile, setShowCollapsedProfile] = useState(false);
  const [showCollapsedGroup, setShowCollapsedGroup] = useState<string | null>(null);
  const [collapsedGroupTop, setCollapsedGroupTop] = useState(0);
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === 'true');
  const [width, setWidth] = useState(() => { const saved = Number(localStorage.getItem(WIDTH_KEY)); return Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : DEFAULT_WIDTH; });
  const [isResizing, setIsResizing] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ laboratory: true });

  useEffect(() => { localStorage.setItem(WIDTH_KEY, String(width)); }, [width]);
  useEffect(() => { localStorage.setItem(COLLAPSED_KEY, String(collapsed)); if (!collapsed) { setShowCollapsedProfile(false); setShowCollapsedGroup(null); } setTooltip(null); }, [collapsed]);
  useEffect(() => { setOpenGroups(current => { const next = { ...current }; groups.forEach(group => { if (group.children.some(item => location.pathname.startsWith(item.path))) next[group.id] = true; }); return next; }); setShowCollapsedGroup(null); setTooltip(null); }, [location.pathname]);
  useEffect(() => { if (!showCollapsedProfile && !showCollapsedGroup) return; const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setShowCollapsedProfile(false); setShowCollapsedGroup(null); } }; window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown); }, [showCollapsedProfile, showCollapsedGroup]);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault(); if (collapsed) return; setIsResizing(true); const startX = event.clientX, startWidth = width;
    const move = (moveEvent: MouseEvent) => setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + moveEvent.clientX - startX)));
    const up = () => { setIsResizing(false); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  }, [width, collapsed]);

  const showTooltip = (event: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>, label: string) => { if (!label) return; const rect = event.currentTarget.getBoundingClientRect(); setTooltip({ label, top: rect.top + rect.height / 2, left: rect.right + 10 }); };
  const hideTooltip = () => setTooltip(null);
  const toggleTheme = () => setMode(theme.mode === 'light' ? 'dark' : 'light');
  const renderLink = (item: { icon?: typeof User; label: string; path: string }, compact = false) => {
    const Icon = item.icon; const active = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`); const tooltipLabel = collapsed ? item.label : '';
    return <Link key={item.path} to={item.path} aria-current={active ? 'page' : undefined} aria-label={collapsed ? item.label : undefined} onMouseEnter={event => showTooltip(event, tooltipLabel)} onMouseLeave={hideTooltip} onFocus={event => showTooltip(event, tooltipLabel)} onBlur={hideTooltip} className={`desktop-nav-link w-full flex items-center gap-3 ${compact ? 'pl-11 pr-3' : 'px-3'} py-2 rounded-md text-left transition-colors ${active ? 'is-active bg-accent text-bg' : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary'}`}>
      {Icon && <Icon size={19} aria-hidden="true" />}<span className="text-sm sidebar-nav-label">{item.label}</span></Link>;
  };
  const openCollapsedGroupMenu = (event: React.MouseEvent<HTMLButtonElement>, groupId: string) => { const rect = event.currentTarget.getBoundingClientRect(); setCollapsedGroupTop(Math.min(Math.max(8, rect.top - 4), window.innerHeight - 220)); setShowCollapsedProfile(false); setTooltip(null); setShowCollapsedGroup(current => current === groupId ? null : groupId); };

  return <>
    <aside style={{ width: collapsed ? COLLAPSED_WIDTH : width }} aria-label="LabOS navigation" className={`desktop-sidebar relative bg-surface border-r border-border flex flex-col flex-shrink-0 ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div onMouseDown={handleMouseDown} onMouseEnter={event => !collapsed && showTooltip(event, 'Drag to resize sidebar')} onMouseLeave={hideTooltip} role="separator" aria-orientation="vertical" aria-label="Resize sidebar" className="absolute right-0 top-0 bottom-0 w-1.5 -mr-0.5 cursor-col-resize z-10 group"><div className={`h-full w-full transition-colors ${isResizing ? 'bg-accent' : 'bg-transparent group-hover:bg-accent/50'}`} /></div>
      <div className="p-3 border-b border-border sidebar-brand-row"><div className="min-w-0"><div className="labos-brand" aria-label="LabOS">LAB<span>OS</span></div><div className="text-[10px] text-text-secondary font-mono mt-1 tracking-wider sidebar-brand-subtitle">LABORATORY OPERATING SYSTEM</div></div><button type="button" onClick={() => setCollapsed(value => !value)} onMouseEnter={event => showTooltip(event, collapsed ? 'Expand sidebar' : 'Collapse sidebar')} onMouseLeave={hideTooltip} onFocus={event => showTooltip(event, collapsed ? 'Expand sidebar' : 'Collapse sidebar')} onBlur={hideTooltip} className="sidebar-collapse-button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button></div>
      <nav className="flex-1 p-2 overflow-y-auto sidebar-nav">
        {primaryItems.filter(item => item.path !== '/downloads' || permissions.includes('resources.edit')).map(item => renderLink(item))}<div className="sidebar-section-divider" aria-hidden="true" />
        {standaloneItems.map(item => renderLink(item))}
        {groups.map(group => { const Icon = group.icon; const collapsedOpen = showCollapsedGroup === group.id; return <div key={group.id} className="mt-1"><button type="button" onClick={event => collapsed ? openCollapsedGroupMenu(event, group.id) : setOpenGroups(current => ({ ...current, [group.id]: !current[group.id] }))} onMouseEnter={event => collapsed && showTooltip(event, group.label)} onMouseLeave={hideTooltip} onFocus={event => collapsed && showTooltip(event, group.label)} onBlur={hideTooltip} aria-label={collapsed ? group.label : undefined} aria-expanded={collapsed ? collapsedOpen : openGroups[group.id]} className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors text-text-secondary hover:bg-surface-raised hover:text-text-primary"><Icon size={19} aria-hidden="true" /><span className="text-sm sidebar-nav-label flex-1">{group.label}</span>{!collapsed && <ChevronDown size={15} className={`transition-transform ${openGroups[group.id] ? '' : '-rotate-90'}`} aria-hidden="true" />}</button>{!collapsed && openGroups[group.id] && group.children.map(child => renderLink(child, true))}</div>; })}
        {user?.role === 'admin' && renderLink({ icon: User, label: 'Users', path: '/users' })}
      </nav>
      {collapsed && showCollapsedGroup && <><div className="fixed inset-0 z-40" aria-hidden="true" onMouseDown={() => setShowCollapsedGroup(null)} /><div role="menu" aria-label={`${groups.find(group => group.id === showCollapsedGroup)?.label || 'Group'} menu`} className="fixed left-[86px] z-50 w-64 rounded-xl border border-border bg-surface-raised shadow-2xl p-2.5" style={{ top: collapsedGroupTop }}>{(() => { const group = groups.find(item => item.id === showCollapsedGroup); if (!group) return null; return <><div className="px-3 py-2 mb-1"><p className="text-sm font-semibold text-text-primary">{group.label}</p><p className="text-xs text-text-secondary mt-0.5">Navigate to {group.label.toLowerCase()}</p></div><div className="h-px bg-border my-1" aria-hidden="true" />{group.children.map(child => { const active = location.pathname === child.path || location.pathname.startsWith(`${child.path}/`); return <Link key={child.path} to={child.path} role="menuitem" onClick={() => setShowCollapsedGroup(null)} className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${active ? 'bg-accent text-bg' : 'text-text-secondary hover:bg-surface hover:text-text-primary'}`}><span>{child.label}</span>{active && <span className="text-[10px] font-mono uppercase tracking-wider">Current</span>}</Link>; })}</>; })()}</div></>}
      {user && <div className="relative p-3 border-t border-border sidebar-user-area">
        {collapsed ? <>
          {showCollapsedProfile && <div className="fixed inset-0 z-40" aria-hidden="true" onMouseDown={() => setShowCollapsedProfile(false)} />}
          <button type="button" onClick={() => { setShowCollapsedGroup(null); setTooltip(null); setShowCollapsedProfile(value => !value); }} onMouseEnter={event => showTooltip(event, `${user.display_name || user.username} profile`)} onMouseLeave={hideTooltip} onFocus={event => showTooltip(event, `${user.display_name || user.username} profile`)} onBlur={hideTooltip} aria-expanded={showCollapsedProfile} aria-haspopup="menu" aria-label={`${user.display_name || user.username} profile`} className={`sidebar-tooltip-trigger relative z-50 mx-auto w-10 h-10 bg-accent rounded-full flex items-center justify-center transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${showCollapsedProfile ? 'ring-2 ring-accent/50' : ''}`}><User size={18} className="text-bg" aria-hidden="true" /></button>
          {showCollapsedProfile && <div role="menu" aria-label="Profile menu" className="fixed left-[86px] bottom-3 z-50 w-72 rounded-xl border border-border bg-surface-raised shadow-2xl p-2.5"><div className="flex items-center gap-3 px-3 py-3 mb-1"><div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0"><User size={18} className="text-bg" aria-hidden="true" /></div><div className="min-w-0"><p className="text-sm font-semibold text-text-primary truncate">{user.display_name || user.username}</p><p className="text-xs text-text-secondary capitalize mt-0.5">{user.role}</p></div></div><div className="h-px bg-border my-1" aria-hidden="true" /><button type="button" role="menuitem" onClick={toggleTheme} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm text-text-secondary hover:bg-surface hover:text-text-primary transition-colors"><span className="flex items-center gap-3">{theme.mode === 'light' ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}Appearance</span><span className="text-xs text-text-secondary">{theme.mode === 'light' ? 'Light' : 'Dark'}</span></button><Link to="/settings" role="menuitem" onClick={() => setShowCollapsedProfile(false)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-text-secondary hover:bg-surface hover:text-text-primary transition-colors"><Settings size={17} aria-hidden="true" />Settings</Link><div className="h-px bg-border my-1" aria-hidden="true" />{onLogout && <button type="button" role="menuitem" onClick={onLogout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-text-secondary hover:bg-surface hover:text-text-primary transition-colors"><LogOut size={17} aria-hidden="true" />Sign out</button>}</div>}
        </> : <><div className="flex items-center gap-3 mb-3"><div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center flex-shrink-0"><User size={16} className="text-bg" aria-hidden="true" /></div><div className="flex-1 min-w-0"><p className="text-text-primary text-sm font-medium truncate sidebar-user-name">{user.display_name || user.username}</p><p className="text-text-secondary text-xs capitalize sidebar-user-role">{user.role}</p></div></div><div className="flex gap-2 sidebar-user-actions"><button type="button" onClick={toggleTheme} title={`Switch to ${theme.mode === 'light' ? 'dark' : 'light'} mode`} aria-label={`Switch to ${theme.mode === 'light' ? 'dark' : 'light'} mode`} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-raised border border-border rounded-md text-text-secondary hover:text-text-primary hover:border-accent transition-colors text-sm">{theme.mode === 'light' ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}</button><Link to="/settings" title="Settings" aria-label="Settings" className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-raised border border-border rounded-md text-text-secondary hover:text-text-primary hover:border-accent transition-colors text-sm"><Settings size={16} aria-hidden="true" /></Link>{onLogout && <button type="button" onClick={onLogout} title="Sign out" aria-label="Sign out" className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-raised border border-border rounded-md text-text-secondary hover:text-text-primary transition-colors text-sm"><LogOut size={16} aria-hidden="true" /></button>}</div></>}
      </div>}
      {tooltip && <div aria-hidden="true" className="fixed z-[200] pointer-events-none -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-[11px] font-medium text-text-primary shadow-lg" style={{ top: tooltip.top, left: tooltip.left }}>{tooltip.label}</div>}
    </aside>
  </>;
}
