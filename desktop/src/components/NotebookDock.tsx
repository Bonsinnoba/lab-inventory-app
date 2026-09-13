import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FileText, Plus, Search, ChevronLeft, ExternalLink, Tag as TagIcon } from 'lucide-react';
import { getNotes, Note } from '../api/notes';

interface Props { onClose: () => void; onOpenFull: () => void; }

export default function NotebookDock({ onClose, onOpenFull }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Note | null>(null);
  const notesQuery = useQuery<Note[]>({
    queryKey: ['notes', 'dock', query],
    queryFn: () => getNotes({ search: query.trim() || undefined }),
    staleTime: 15000,
  });
  const notes = notesQuery.data || [];

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          {selected ? (
            <button type="button" onClick={() => setSelected(null)} className="p-1.5 -ml-1 rounded-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/60" aria-label="Back to notes">
              <ChevronLeft size={16} />
            </button>
          ) : <FileText size={17} className="text-accent" aria-hidden="true" />}
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold truncate">{selected ? selected.title : 'Notebook'}</h2>
            <p className="text-[11px] text-text-secondary mt-0.5">{selected ? 'Note preview' : 'Quick access to your notes'}</p>
          </div>
          {!selected && <button type="button" onClick={onOpenFull} title="New note" aria-label="Create a new note" className="p-2 rounded-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/60"><Plus size={16} /></button>}
          <button type="button" onClick={onClose} title="Close Notebook" aria-label="Close Notebook" className="p-2 rounded-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/60"><span aria-hidden="true">×</span></button>
        </div>
      </header>

      {selected ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <div className="text-[11px] text-text-secondary mb-3">{selected.updated_at ? new Date(selected.updated_at).toLocaleString() : 'Note'}</div>
          {selected.tags?.length > 0 && <div className="flex flex-wrap gap-1.5 mb-4">{selected.tags.map(tag => <span key={tag} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-surface-raised border border-border text-[10px] text-text-secondary"><TagIcon size={10} />{tag}</span>)}</div>}
          <div className="text-sm leading-6 whitespace-pre-wrap break-words text-text-primary">{selected.body || <span className="text-text-secondary italic">This note has no content.</span>}</div>
          <button type="button" onClick={onOpenFull} className="mt-6 w-full inline-flex items-center justify-center gap-2 px-3 py-2 border border-border rounded-sm text-xs font-medium text-text-secondary hover:text-text-primary hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent/60"><ExternalLink size={14} />Open in Notebook</button>
        </div>
      ) : (
        <>
          <div className="p-3 border-b border-border flex-shrink-0">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search notes…" aria-label="Search notes" className="w-full bg-surface-raised border border-border rounded-sm pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30" />
            </div>
          </div>
          <div className="px-3 py-2 flex items-center justify-between flex-shrink-0">
            <span className="text-[11px] text-text-secondary">{notesQuery.isLoading ? 'Loading notes…' : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}</span>
            <button type="button" onClick={onOpenFull} className="text-[11px] text-accent hover:underline focus:outline-none focus:ring-1 focus:ring-accent/50 rounded">Open full notebook</button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
            {notesQuery.isLoading ? <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="p-3 rounded-sm border border-border animate-pulse"><div className="h-3.5 w-3/4 bg-surface-raised rounded" /><div className="h-2.5 w-full bg-surface-raised rounded mt-2" /><div className="h-2.5 w-1/2 bg-surface-raised rounded mt-1.5" /></div>)}</div>
              : notesQuery.error ? <div className="p-4 text-center border border-status-danger/30 bg-status-danger/5 rounded-sm"><p className="text-xs text-status-danger font-medium">Notes could not be loaded</p><button type="button" onClick={() => notesQuery.refetch()} className="mt-3 px-3 py-1.5 text-xs border border-border rounded-sm hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50">Try again</button></div>
              : notes.length === 0 ? <div className="p-6 text-center"><FileText size={26} className="mx-auto text-text-secondary mb-2" /><p className="text-xs font-medium">{query ? 'No matching notes' : 'No notes yet'}</p><p className="text-[11px] text-text-secondary mt-1">{query ? 'Try a broader search.' : 'Create your first note from the full Notebook.'}</p></div>
              : <div className="space-y-1.5">{notes.map(note => <button key={note.id} type="button" onClick={() => setSelected(note)} className="w-full text-left p-3 rounded-sm border border-border hover:border-accent hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/60 transition-colors"><div className="flex items-start gap-2"><FileText size={14} className="mt-0.5 text-accent flex-shrink-0" /><div className="min-w-0"><p className="text-xs font-medium truncate">{note.title}</p><p className="text-[11px] text-text-secondary line-clamp-2 mt-1">{note.body || 'No content'}</p>{note.tags?.length > 0 && <div className="flex gap-1 mt-2 overflow-hidden">{note.tags.slice(0, 2).map(tag => <span key={tag} className="px-1.5 py-0.5 rounded bg-surface-raised text-[9px] text-text-secondary truncate">{tag}</span>)}</div>}</div></div></button>)}</div>}
          </div>
        </>
      )}
    </div>
  );
}
