import { Bot, BookOpen, Search } from 'lucide-react';

export type DockableContent = 'assistant' | 'notebook' | 'search' | null;

interface ActivityRailProps {
  active: DockableContent;
  onSelect: (content: DockableContent) => void;
}

const items: { id: Exclude<DockableContent, null>; icon: typeof Bot; label: string }[] = [
  { id: 'assistant', icon: Bot, label: 'Lab Assistant' },
  { id: 'notebook', icon: BookOpen, label: 'Notebook' },
  { id: 'search', icon: Search, label: 'Search' },
];

export default function ActivityRail({ active, onSelect }: ActivityRailProps) {
  return (
    <div className="desktop-activity-rail w-12 flex-shrink-0 bg-surface border-l border-border flex flex-col items-center py-3 gap-1">
      {items.map(({ id, icon: Icon, label }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            onClick={() => onSelect(isActive ? null : id)}
            title={label}
            className={`w-9 h-9 flex items-center justify-center rounded-sm transition-colors ${
              isActive
                ? 'text-accent bg-accent/10'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-raised'
            }`}
          >
            <Icon size={20} />
          </button>
        );
      })}
    </div>
  );
}
