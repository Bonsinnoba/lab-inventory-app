import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, BarChart3, BookOpen, Box, Bot, Calculator, Command, FileText, ShieldCheck,
  Folder, Layers, Search, Settings, Users, X, Zap, Music2,
} from 'lucide-react';

interface CommandPaletteProps { open: boolean; onClose: () => void; }

type CommandItem = {
  id: string;
  label: string;
  hint: string;
  path: string;
  icon: typeof Search;
  keywords: string;
};

const COMMANDS: CommandItem[] = [
  { id: 'dashboard', label: 'Dashboard', hint: 'Command center', path: '/dashboard', icon: Activity, keywords: 'home overview command center' },
  { id: 'projects', label: 'Projects', hint: 'Workspaces', path: '/projects', icon: Layers, keywords: 'project workspace research' },
  { id: 'inventory', label: 'Inventory', hint: 'Items & assets', path: '/inventory', icon: Box, keywords: 'stock equipment components assets' },
  { id: 'notebook', label: 'Notebook', hint: 'Lab notes', path: '/notebook', icon: FileText, keywords: 'notes notebook journal' },
  { id: 'knowledge', label: 'Knowledge', hint: 'Lab knowledge', path: '/knowledge', icon: BookOpen, keywords: 'knowledge documents references' },
  { id: 'resources', label: 'Resources', hint: 'Files & media', path: '/resources', icon: Folder, keywords: 'files pdf images documents media' },
  { id: 'search', label: 'Global Search', hint: 'Find anything', path: '/search', icon: Search, keywords: 'find universal search' },
  { id: 'engineering', label: 'Engineering Tools', hint: 'Calculators & BOM', path: '#engineering-tools', icon: Calculator, keywords: 'electronics calculator bom engineering' },
  { id: 'assistant', label: 'Lab Assistant', hint: 'Ask the lab', path: '/assistant', icon: Bot, keywords: 'ai assistant help' },
  { id: 'reports', label: 'Reports', hint: 'Analytics & exports', path: '/reports', icon: BarChart3, keywords: 'analytics csv reporting statistics' },
  { id: 'automation', label: 'Automation', hint: 'Reminders & due work', path: '/automation', icon: Zap, keywords: 'reminders notifications automation' },
  { id: 'media', label: 'Media Manager', hint: 'Local media & music', path: '#media-manager', icon: Music2, keywords: 'music audio media player local' },
  { id: 'daily-use', label: 'Daily Use & System', hint: 'Health, export & preferences', path: '/daily-use', icon: ShieldCheck, keywords: 'health backup export notifications voice' },
  { id: 'collaboration', label: 'Collaboration', hint: 'Team activity', path: '/collaboration', icon: Users, keywords: 'team comments activity' },
  { id: 'settings', label: 'Settings', hint: 'Account & appearance', path: '/settings', icon: Settings, keywords: 'profile password theme preferences' },
];

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const activate = (item: CommandItem) => {
    if (item.id === 'engineering') {
      window.dispatchEvent(new CustomEvent('labos:engineering-tools'));
    } else if (item.id === 'media') {
      window.dispatchEvent(new CustomEvent('labos:media-manager'));
    } else {
      navigate(item.path);
    }
    onClose();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((item) => `${item.label} ${item.hint} ${item.keywords}`.toLowerCase().includes(q));
  }, [query]);

  useEffect(() => {
    if (!open) {
      previouslyFocused.current?.focus();
      previouslyFocused.current = null;
      return;
    }
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0))); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); return; }
      if (event.key === 'Enter' && filtered[activeIndex]) {
        event.preventDefault(); activate(filtered[activeIndex]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, navigate, filtered, activeIndex]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  if (!open) return null;

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="LabOS command palette">
        <div className="command-palette-search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages and actions…"
            aria-label="Search pages and actions"
          />
          <kbd>ESC</kbd>
          <button type="button" onClick={onClose} aria-label="Close command palette"><X size={17} /></button>
        </div>
        <div className="command-palette-meta">
          <span><Command size={12} /> Quick navigation</span>
          <span>↑ ↓ navigate · Enter open</span>
        </div>
        <div className="command-palette-list" role="listbox" aria-label="Available commands">
          {filtered.length ? filtered.map((item, index) => {
            const Icon = item.icon;
            const active = index === activeIndex;
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={active}
                className={`command-palette-item ${active ? 'active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => activate(item)}
              >
                <span className="command-palette-icon"><Icon size={17} /></span>
                <span className="command-palette-copy"><strong>{item.label}</strong><small>{item.hint}</small></span>
                {active && <span className="command-palette-enter">Enter</span>}
              </button>
            );
          }) : (
            <div className="command-palette-empty"><Search size={22} /><span>No matching LabOS destination.</span></div>
          )}
        </div>
        <div className="command-palette-footer"><span>LABOS COMMAND CENTER</span><span>{filtered.length} destination{filtered.length === 1 ? '' : 's'}</span></div>
      </section>
    </div>
  );
}
