import { Search, Command } from 'lucide-react';
import { Link } from 'react-router-dom';

interface TopBarProps { title: string; onOpenCommandPalette: () => void; }

export default function TopBar({ title, onOpenCommandPalette }: TopBarProps) {
  return (
    <div className="desktop-topbar h-14 bg-surface border-b border-border flex items-center justify-between px-6 gap-6">
      <div className="min-w-0 flex items-center gap-3">
        <div className="topbar-page-mark" aria-hidden="true" />
        <div className="min-w-0">
          <div className="page-kicker">LABOS / WORKSPACE</div>
          <h1 className="text-sm font-ui font-semibold truncate mt-0.5">{title}</h1>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onOpenCommandPalette} className="topbar-search hidden md:flex items-center gap-2 px-3 py-1.5 rounded-sm text-text-secondary hover:text-text-primary" title="Open command palette">
          <Search size={15} />
          <span className="text-xs flex-1">Search laboratory…</span>
          <span className="font-mono text-[10px] border border-border rounded px-1.5 py-0.5 flex items-center gap-1"><Command size={10}/>K</span>
        </button>
        <Link to="/search" className="p-2 hover:bg-surface-raised rounded-sm transition-colors text-text-secondary hover:text-text-primary" title="Search">
          <Search size={19} />
        </Link>
      </div>
    </div>
  );
}
