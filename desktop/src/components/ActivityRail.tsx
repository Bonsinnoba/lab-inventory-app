import { Bot, BookOpen, Search, Calculator, Music2, FolderOpen } from 'lucide-react';

export type DockableContent = 'assistant' | 'notebook' | 'search' | null;
interface ActivityRailProps { active: DockableContent; onSelect: (content: DockableContent) => void; engineeringOpen?: boolean; musicOpen?: boolean; mediaOpen?: boolean; }
const items: { id: Exclude<DockableContent, null>; icon: typeof Bot; label: string }[] = [
  { id: 'assistant', icon: Bot, label: 'Lab Assistant' },
  { id: 'notebook', icon: BookOpen, label: 'Notebook' },
  { id: 'search', icon: Search, label: 'Search' },
];
const buttonClass = 'relative w-9 h-9 flex items-center justify-center rounded-md transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-surface';
const activeClass = 'bg-accent/12 text-accent';
const idleClass = 'text-text-secondary hover:text-text-primary hover:bg-surface-raised';
function ToolButton({ label, active = false, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} title={active ? `Close ${label}` : label} aria-label={active ? `Close ${label}` : label} aria-pressed={active} className={`${buttonClass} ${active ? activeClass : idleClass}`}>
    {active && <span aria-hidden="true" className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-accent" />}{children}
  </button>;
}
export default function ActivityRail({ active, onSelect, engineeringOpen = false, musicOpen = false, mediaOpen = false }: ActivityRailProps) {
  return <aside className="desktop-activity-rail w-12 flex-shrink-0 bg-surface border-l border-border flex flex-col items-center py-3 gap-1" aria-label="Workspace tools">
    <div className="flex flex-col items-center gap-1" role="toolbar" aria-label="Docked workspace tools">
      {items.map(({ id, icon: Icon, label }) => <ToolButton key={id} label={label} active={active === id} onClick={() => onSelect(active === id ? null : id)}><Icon size={19} strokeWidth={active === id ? 2.2 : 2} aria-hidden="true" /></ToolButton>)}
    </div>
    <div className="w-9 my-2 border-t border-border" aria-hidden="true" />
    <div className="flex flex-col items-center gap-1" role="group" aria-label="Engineering tools">
      <ToolButton label="Engineering Tools" active={engineeringOpen} onClick={() => window.dispatchEvent(new CustomEvent('labos:engineering-tools'))}><Calculator size={19} strokeWidth={engineeringOpen ? 2.2 : 2} aria-hidden="true" /></ToolButton>
    </div>
    <div className="mt-auto pt-2 border-t border-border w-9 flex flex-col items-center gap-1" role="group" aria-label="Media tools">
      <ToolButton label="Music Player" active={musicOpen} onClick={() => window.dispatchEvent(new CustomEvent('labos:music-player'))}><Music2 size={19} strokeWidth={musicOpen ? 2.2 : 2} aria-hidden="true" /></ToolButton>
      <ToolButton label="Media Manager" active={mediaOpen} onClick={() => window.dispatchEvent(new CustomEvent('labos:media-manager'))}><FolderOpen size={19} strokeWidth={mediaOpen ? 2.2 : 2} aria-hidden="true" /></ToolButton>
    </div>
  </aside>;
}
