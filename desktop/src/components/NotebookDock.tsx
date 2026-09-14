import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { FileText, Plus, Search, ExternalLink, Save, X, Loader2 } from 'lucide-react';
import { createNote, getNotes, Note, updateNote } from '../api/notes';
import { getProjects, Project } from '../api/projects';

interface Props { onClose: () => void; onOpenFull: () => void; }
type Draft = { id?: string; title: string; body: string; project_id?: string };
const blankDraft = (): Draft => ({ title: '', body: '' });

export default function NotebookDock({ onClose, onOpenFull }: Props) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [editing, setEditing] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const notesQuery = useQuery<Note[]>({ queryKey: ['notes', 'dock', query], queryFn: () => getNotes({ search: query.trim() || undefined }), staleTime: 15000 });
  const projectsQuery = useQuery<Project[]>({ queryKey: ['projects', 'dock'], queryFn: getProjects, staleTime: 30000 });
  const notes = notesQuery.data || [];
  const projects = projectsQuery.data || [];
  const selectedNote = useMemo(() => draft.id ? notes.find(note => note.id === draft.id) : undefined, [draft.id, notes]);
  const isDirty = editing && !!draft.id ? draft.title !== selectedNote?.title || draft.body !== selectedNote?.body || draft.project_id !== selectedNote?.project_id : editing && (!!draft.title.trim() || !!draft.body.trim());
  const saveMutation = useMutation({
    mutationFn: async () => {
      const title = draft.title.trim() || 'Untitled note';
      if (draft.id) return updateNote(draft.id, { title, body: draft.body, project_id: draft.project_id || undefined });
      return createNote({ title, body: draft.body, tags: [], project_id: draft.project_id });
    },
    onSuccess: async note => {
      setDraft({ id: note.id, title: note.title, body: note.body, project_id: note.project_id });
      setEditing(true); setSavedMessage('Saved');
      await queryClient.invalidateQueries({ queryKey: ['notes'] });
      window.setTimeout(() => setSavedMessage(''), 1800);
    },
  });
  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!saveMutation.isPending && (draft.title.trim() || draft.body.trim())) saveMutation.mutate(); }
    };
    window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, draft.title, draft.body, saveMutation.isPending]);
  const startNew = () => { setDraft(blankDraft()); setEditing(true); setSavedMessage(''); };
  const editNote = (note: Note) => { setDraft({ id: note.id, title: note.title, body: note.body, project_id: note.project_id }); setEditing(true); setSavedMessage(''); };
  const cancelEdit = () => { setDraft(blankDraft()); setEditing(false); setSavedMessage(''); };

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface">
      <header className="px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileText size={17} className="text-accent flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold truncate">Notebook</h2><p className="text-[11px] text-text-secondary mt-0.5">Quick capture & recent notes</p></div>
          <button type="button" onClick={startNew} title="New note" aria-label="Create a new note" className="p-2 rounded-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/60"><Plus size={16} /></button>
          <button type="button" onClick={onClose} title="Close Notebook" aria-label="Close Notebook" className="p-2 rounded-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/60"><span aria-hidden="true">×</span></button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col p-3">
        <div className="flex items-center justify-between mb-2 flex-shrink-0">
          <span className="text-[11px] uppercase tracking-wide text-text-secondary font-medium">Quick note</span>
          {editing && <span className="text-[10px] text-text-secondary">{draft.id ? 'Editing' : 'New'}</span>}
        </div>
        {editing ? (
          <div className="flex-1 min-h-0 flex flex-col gap-2">
            <input value={draft.title} onChange={e => setDraft(current => ({ ...current, title: e.target.value }))} placeholder="Note title" aria-label="Note title" autoFocus className="w-full flex-shrink-0 bg-surface-raised border border-border rounded-sm px-3 py-2 text-xs font-medium focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30" />
            <textarea value={draft.body} onChange={e => setDraft(current => ({ ...current, body: e.target.value }))} placeholder="Capture a thought, task, observation…" aria-label="Note content" className="flex-1 min-h-0 w-full resize-none bg-surface-raised border border-border rounded-sm px-3 py-3 text-xs leading-5 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30" />
            <div className="flex items-center gap-2 flex-shrink-0">
              <select value={draft.project_id || ''} onChange={e => setDraft(current => ({ ...current, project_id: e.target.value || undefined }))} aria-label="Associate note with project" className="min-w-0 flex-1 bg-surface-raised border border-border rounded-sm px-2.5 py-2 text-[11px] focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30" disabled={projectsQuery.isLoading}>
                <option value="">No project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
              <button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || (!draft.title.trim() && !draft.body.trim())} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-sm bg-accent text-white text-[11px] font-medium disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-accent/50">{saveMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}{saveMutation.isPending ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={cancelEdit} aria-label="Close note editor" className="p-2 rounded-sm border border-border text-text-secondary hover:text-text-primary hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/60"><X size={14} /></button>
            </div>
            <div className="min-h-4 flex-shrink-0 text-[10px]" aria-live="polite">{saveMutation.error ? <span className="text-status-danger">Could not save note. Try again.</span> : savedMessage ? <span className="text-status-success">{savedMessage}</span> : isDirty && <span className="text-text-secondary">Unsaved changes · Ctrl/Cmd+S to save</span>}</div>
          </div>
        ) : (
          <button type="button" onClick={startNew} className="flex-1 min-h-0 w-full text-left p-4 rounded-sm border border-dashed border-border text-xs text-text-secondary hover:border-accent hover:text-text-primary hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/60">
            <span className="font-medium text-text-primary">Jot something down</span><span className="block mt-1 text-[11px]">Write it here without leaving your current workspace.</span>
          </button>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border flex items-center gap-2 flex-shrink-0">
        <div className="relative flex-1 min-w-0"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search notes…" aria-label="Search notes" className="w-full bg-surface-raised border border-border rounded-sm pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30" /></div>
        <span className="text-[10px] text-text-secondary whitespace-nowrap">{notesQuery.isLoading ? '…' : notes.length}</span>
      </div>
      <div className="max-h-[30%] min-h-[120px] overflow-y-auto px-3 py-2 flex-shrink-0">
        <div className="flex items-center justify-between mb-2"><span className="text-[11px] uppercase tracking-wide text-text-secondary font-medium">Recent notes</span><button type="button" onClick={onOpenFull} className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline focus:outline-none focus:ring-1 focus:ring-accent/50 rounded">Full notebook <ExternalLink size={11} /></button></div>
        {notesQuery.isLoading ? <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="p-3 rounded-sm border border-border animate-pulse"><div className="h-3.5 w-3/4 bg-surface-raised rounded" /><div className="h-2.5 w-full bg-surface-raised rounded mt-2" /></div>)}</div>
          : notesQuery.error ? <div className="p-3 text-center border border-status-danger/30 bg-status-danger/5 rounded-sm"><p className="text-xs text-status-danger font-medium">Notes could not be loaded</p><button type="button" onClick={() => notesQuery.refetch()} className="mt-2 px-3 py-1.5 text-xs border border-border rounded-sm hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50">Try again</button></div>
          : notes.length === 0 ? <div className="p-4 text-center border border-dashed border-border rounded-sm"><FileText size={20} className="mx-auto text-text-secondary mb-1.5" /><p className="text-xs font-medium">{query ? 'No matching notes' : 'No notes yet'}</p></div>
          : <div className="space-y-1.5">{notes.map(note => <button key={note.id} type="button" onClick={() => editNote(note)} className={`w-full text-left p-2.5 rounded-sm border transition-colors focus:outline-none focus:ring-2 focus:ring-accent/60 ${draft.id === note.id && editing ? 'border-accent bg-surface-raised' : 'border-border hover:border-accent hover:bg-surface-raised'}`}><div className="flex items-center gap-2"><FileText size={13} className="text-accent flex-shrink-0" /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium truncate">{note.title || 'Untitled note'}</p><span className="text-[9px] text-text-secondary flex-shrink-0">{new Date(note.updated_at).toLocaleDateString()}</span></div><p className="text-[10px] text-text-secondary truncate mt-0.5">{note.body || 'No content'}</p></div></div></button>)}</div>}
      </div>
    </div>
  );
}
