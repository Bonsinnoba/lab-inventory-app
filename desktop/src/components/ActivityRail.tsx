import { Bot, BookOpen, Search, Calculator, Music2, FolderOpen } from 'lucide-react';

export type DockableContent = 'assistant' | 'notebook' | 'search' | null;
interface ActivityRailProps { active: DockableContent; onSelect: (content: DockableContent) => void; }
const items: { id: Exclude<DockableContent, null>; icon: typeof Bot; label: string }[] = [
  { id: 'assistant', icon: Bot, label: 'Lab Assistant' },
  { id: 'notebook', icon: BookOpen, label: 'Notebook' },
  { id: 'search', icon: Search, label: 'Search' },
];

const buttonClass = 'relative w-9 h-9 flex items-center justify-center rounded-md transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-surface';

export default function ActivityRail({ active, onSelect }: ActivityRailProps) {
  return (
    <aside className="desktop-activity-rail w-12 flex-shrink-0 bg-surface border-l border-border flex flex-col items-center py-3 gap-1" aria-label="Workspace tools">
      <div className="flex flex-col items-center gap-1" role="toolbar" aria-label="Docked workspace tools">
        {items.map(({ id, icon: Icon, label }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(isActive ? null : id)}
              title={isActive ? `Close ${label}` : label}
              aria-label={isActive ? `Close ${label}` : label}
              aria-pressed={isActive}
              className={`${buttonClass} ${isActive ? 'bg-accent/12 text-accent' : 'text-text-secondary hover:text-text-primary hover:bg-surface-raised'}`}
            >
              {isActive && <span aria-hidden="true" className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-accent" />}
              <Icon size={19} strokeWidth={isActive ? 2.2 : 2} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('labos:engineering-tools'))}
        title="Engineering Tools"
        aria-label="Engineering Tools"
        className={`${buttonClass} text-text-secondary hover:text-text-primary hover:bg-surface-raised mt-1`}
      >
        <Calculator size={19} aria-hidden="true" />
      </button>

      <div className="mt-auto pt-2 border-t border-border w-9 flex flex-col items-center gap-1" role="group" aria-label="Additional workspace tools">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('labos:music-player'))}
          title="Music Player"
          aria-label="Music Player"
          className={`${buttonClass} text-text-secondary hover:text-text-primary hover:bg-surface-raised`}
        >
          <Music2 size={19} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('labos:media-manager'))}
          title="Media Manager"
          aria-label="Media Manager"
          className={`${buttonClass} text-text-secondary hover:text-text-primary hover:bg-surface-raised`}
        >
          <FolderOpen size={19} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
