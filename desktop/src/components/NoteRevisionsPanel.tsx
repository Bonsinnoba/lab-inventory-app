import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, RotateCcw } from 'lucide-react';
import { getNoteRevisions, restoreNoteRevision, type Note } from '../api/notes';
import { useToast } from '../contexts/ToastContext';

export default function NoteRevisionsPanel({ note, onRestored }: { note: Note; onRestored: (note: Note) => void }) {
  const queryClient = useQueryClient(); const { showToast } = useToast();
  const revisions = useQuery({ queryKey: ['note-revisions', note.id], queryFn: () => getNoteRevisions(note.id) });
  const restore = useMutation({ mutationFn: (revisionId: string) => restoreNoteRevision(note.id, revisionId), onSuccess: (restored) => { queryClient.invalidateQueries({ queryKey: ['note-revisions', note.id] }); onRestored(restored); showToast('Note revision restored'); }, onError: (error: Error) => showToast(error.message, 'error') });
  if (!revisions.data?.length) return null;
  return <details className="border-t border-border px-4 py-3 flex-shrink-0"><summary className="cursor-pointer list-none flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary"><History size={14} />Revision history ({revisions.data.length})</summary><div className="mt-3 space-y-2 max-h-40 overflow-y-auto">{revisions.data.map((revision) => <div key={revision.id} className="flex items-center justify-between gap-3 p-2 bg-surface-raised border border-border rounded-sm"><div className="min-w-0"><div className="text-xs text-text-primary truncate">{revision.title}</div><div className="text-[11px] text-text-secondary">{revision.editor || 'Unknown editor'} · {new Date(revision.created_at).toLocaleString()}</div></div><button type="button" onClick={() => { if (window.confirm('Restore this revision? The current note will be saved as a new revision.')) restore.mutate(revision.id); }} disabled={restore.isPending} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-accent disabled:opacity-50"><RotateCcw size={12} />Restore</button></div>)}</div></details>;
}
