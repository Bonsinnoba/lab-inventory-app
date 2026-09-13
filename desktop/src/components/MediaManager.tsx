import { FolderOpen, Music2, X } from 'lucide-react';

interface Props { open: boolean; onClose: () => void; onOpenMusic: () => void; }

export default function MediaManager({ open, onClose, onOpenMusic }: Props) {
  if (!open) return null;

  return (
    <div className="h-full w-full flex flex-col bg-surface" role="region" aria-label="Media Manager">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border flex-shrink-0 min-h-[56px] bg-surface/95 backdrop-blur">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.16em] text-text-secondary">Daily use</div>
          <h2 className="text-sm font-semibold text-text-primary truncate">Media Manager</h2>
        </div>
        <button type="button" onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70" title="Close Media Manager" aria-label="Close Media Manager">
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-auto p-4">
        <div className="mb-4">
          <p className="text-sm font-medium text-text-primary">Media tools</p>
          <p className="text-xs text-text-secondary mt-1">Local utilities stay separate from project resources.</p>
        </div>

        <div className="space-y-2">
          <button type="button" onClick={onOpenMusic} className="w-full p-3.5 text-left border border-border rounded-xl bg-surface-raised/40 hover:bg-surface-raised hover:border-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 shrink-0 rounded-lg bg-accent/10 text-accent flex items-center justify-center"><Music2 size={18} aria-hidden="true" /></div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-text-primary">Music Player</div>
                <div className="text-xs text-text-secondary mt-1 leading-relaxed">Manage and play local audio without putting music into LabOS.</div>
              </div>
            </div>
          </button>

          <div className="p-3.5 border border-border rounded-xl bg-surface-raised/20">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 shrink-0 rounded-lg bg-accent/10 text-accent flex items-center justify-center"><FolderOpen size={18} aria-hidden="true" /></div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-text-primary">Lab media</div>
                <div className="text-xs text-text-secondary mt-1 leading-relaxed">Project resources and lab media remain in the existing Resources workflow.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
