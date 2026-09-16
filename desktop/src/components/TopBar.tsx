import { Search, Command, ScanLine } from 'lucide-react';
import { Link } from 'react-router-dom';
import NotificationCenter from './NotificationCenter';
import SyncStatus from './SyncStatus';

interface TopBarProps { title: string; onOpenCommandPalette: () => void; onScan: () => void; }

export default function TopBar({ title, onOpenCommandPalette, onScan }: TopBarProps) {
  return (
    <header className="desktop-topbar h-14 bg-surface border-b border-border flex items-center justify-between px-4 md:px-6 gap-4">
      <div className="min-w-0 flex items-center gap-3">
        <div className="topbar-page-mark" aria-hidden="true" />
        <div className="min-w-0">
          <div className="page-kicker">LABOS / WORKSPACE</div>
          <h1 className="text-sm font-ui font-semibold truncate mt-0.5">{title}</h1>
        </div>
      </div>

      <div className="flex items-center gap-1.5 ml-auto">
        <button
          type="button"
          onClick={onScan}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          title="Scan Item"
          aria-label="Scan Item"
        >
          <ScanLine size={18} aria-hidden="true" />
          <span className="hidden sm:inline text-xs font-medium">Scan Item</span>
        </button>
        <SyncStatus />
        <NotificationCenter />

        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="topbar-search hidden md:flex items-center gap-2 px-3 py-1.5 rounded-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          title="Open command palette"
          aria-label="Open command palette"
        >
          <Search size={15} aria-hidden="true" />
          <span className="text-xs flex-1">Search laboratory…</span>
          <span className="font-mono text-[10px] border border-border rounded px-1.5 py-0.5 flex items-center gap-1" aria-hidden="true">
            <Command size={10} />K
          </span>
        </button>

        <Link
          to="/search"
          className="topbar-search-link p-2 rounded-sm transition-colors text-text-secondary hover:text-text-primary hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          title="Open full search"
          aria-label="Open full search"
        >
          <Search size={19} aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}
