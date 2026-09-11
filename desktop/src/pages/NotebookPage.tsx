import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getNotes, getAllTags, createNote, updateNote, deleteNote, Note } from '../api/notes';
import {
  Plus, Search, X, Trash2, Tag as TagIcon, Mic, Volume2, Sigma, Save, Square,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useToast } from '../contexts/ToastContext';
import SymbolPickerModal from '../components/SymbolPickerModal';
import NoteRevisionsPanel from '../components/NoteRevisionsPanel';

type Draft = { id: string | 'new' | null; title: string; body: string; tags: string[] };
const EMPTY_DRAFT: Draft = { id: null, title: '', body: '', tags: [] };

export default function NotebookPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [tagInput, setTagInput] = useState('');
  const [showSymbolPicker, setShowSymbolPicker] = useState(false);
  const [isListCollapsed, setIsListCollapsed] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  const { data: notes = [], isLoading, error } = useQuery<Note[]>({
    queryKey: ['notes', { tag: selectedTag, search: searchQuery }],
    queryFn: () => getNotes({ tag: selectedTag || undefined, search: searchQuery || undefined }),
  });

  const { data: allTags = [] } = useQuery<string[]>({
    queryKey: ['tags'],
    queryFn: getAllTags,
  });

  const originalNote = draft.id && draft.id !== 'new' ? notes.find((n) => n.id === draft.id) : null;
  const isDirty = draft.id === 'new'
    ? draft.title.trim() !== '' || draft.body.trim() !== ''
    : originalNote
      ? draft.title !== originalNote.title || draft.body !== originalNote.body ||
        JSON.stringify(draft.tags) !== JSON.stringify(originalNote.tags)
      : false;

  const createMutation = useMutation({
    mutationFn: (note: Omit<Note, 'id' | 'created_at' | 'updated_at'>) => createNote(note),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setDraft({ id: created.id, title: created.title, body: created.body, tags: created.tags });
      showToast('Note created');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to create note', 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: Partial<Note> }) => updateNote(id, note),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setDraft({ id: updated.id, title: updated.title, body: updated.body, tags: updated.tags });
      showToast('Note saved');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to save note', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteNote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setDraft(EMPTY_DRAFT);
      showToast('Note deleted');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to delete note', 'error'),
  });

  const confirmDiscardIfDirty = () => {
    if (!isDirty) return true;
    return window.confirm('Discard unsaved changes to this note?');
  };

  const handleSelectNote = (note: Note) => {
    if (draft.id === note.id) return;
    if (!confirmDiscardIfDirty()) return;
    setDraft({ id: note.id, title: note.title, body: note.body, tags: note.tags });
  };

  const handleNewNote = () => {
    if (draft.id === 'new' && !isDirty) return;
    if (!confirmDiscardIfDirty()) return;
    setDraft({ id: 'new', title: '', body: '', tags: [] });
  };

  const handleSave = () => {
    if (!draft.title.trim()) {
      showToast('Give the note a title before saving', 'error');
      return;
    }
    if (draft.id === 'new') {
      createMutation.mutate({ title: draft.title, body: draft.body, tags: draft.tags });
    } else if (draft.id) {
      updateMutation.mutate({ id: draft.id, note: { title: draft.title, body: draft.body, tags: draft.tags } });
    }
  };

  const handleDelete = () => {
    if (draft.id && draft.id !== 'new' && window.confirm('Delete this note? This can\'t be undone.')) {
      deleteMutation.mutate(draft.id);
    }
  };

  const handleAddTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !draft.tags.includes(trimmed)) {
      setDraft({ ...draft, tags: [...draft.tags, trimmed] });
    }
    setTagInput('');
  };

  // Inserts a symbol at the current cursor position in the body textarea,
  // then restores focus and cursor placement right after it.
  const insertSymbol = (symbol: string) => {
    const el = bodyRef.current;
    if (!el) {
      setDraft({ ...draft, body: draft.body + symbol });
      return;
    }
    const start = el.selectionStart ?? draft.body.length;
    const end = el.selectionEnd ?? draft.body.length;
    const newBody = draft.body.slice(0, start) + symbol + draft.body.slice(end);
    setDraft({ ...draft, body: newBody });
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + symbol.length;
    });
  };

  // Text-to-speech ("read aloud") -- a plain browser API, no hardware
  // permissions needed, so this works reliably wherever the app runs.
  const handleReadAloud = () => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    if (!draft.body.trim()) {
      showToast('Nothing to read — this note is empty', 'error');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(`${draft.title}. ${draft.body}`);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  // Voice dictation. Unlike read-aloud, this needs microphone access and
  // relies on the Web Speech API's SpeechRecognition, whose availability
  // and reliability inside a Tauri webview can't be verified from here --
  // it's feature-detected and fails gracefully with a clear message
  // rather than assumed to work.
  const handleToggleDictation = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast('Voice input isn\'t available in this app build', 'error');
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((r: any) => r[0].transcript)
        .join(' ');
      setDraft((prev) => ({ ...prev, body: prev.body ? `${prev.body} ${transcript}` : transcript }));
    };
    recognition.onerror = () => {
      showToast('Voice input stopped unexpectedly', 'error');
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    setIsListening(true);
    try {
      recognition.start();
    } catch {
      showToast('Could not start voice input', 'error');
      setIsListening(false);
    }
  };

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      window.speechSynthesis.cancel();
    };
  }, []);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex h-full gap-4 p-4 min-h-0">
      {/* List pane */}
      <div className={`flex-shrink-0 bg-surface border border-border rounded-md shadow-md flex flex-col overflow-hidden transition-[width] duration-200 ${isListCollapsed ? 'w-12' : 'w-80'}`}>
        {isListCollapsed ? (
          <div className="flex flex-col items-center pt-4">
            <button
              onClick={() => setIsListCollapsed(false)}
              title="Expand notes list"
              className="p-2 hover:bg-surface-raised rounded-sm transition-colors text-text-secondary hover:text-text-primary"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        ) : (
          <>
        <div className="p-4 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-page-title font-ui font-semibold">Notes</h2>
            <button
              onClick={() => setIsListCollapsed(true)}
              title="Collapse notes list"
              className="p-1.5 hover:bg-surface-raised rounded-sm transition-colors text-text-secondary hover:text-text-primary flex-shrink-0"
            >
              <ChevronLeft size={17} />
            </button>
          </div>
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={16} />
            <input
              type="text"
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-surface-raised border border-border rounded-sm text-text-primary text-sm placeholder:text-text-secondary focus:outline-none focus:border-accent"
            />
          </div>
          {allTags.length > 0 && (
            <select
              value={selectedTag || ''}
              onChange={(e) => setSelectedTag(e.target.value || null)}
              className="w-full px-3 py-1.5 bg-surface-raised border border-border rounded-sm text-text-primary text-sm mb-2 focus:outline-none focus:border-accent"
            >
              <option value="">All Tags</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
          )}
          <button
            onClick={handleNewNote}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors font-medium"
          >
            <Plus size={16} />
            New Note
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-text-secondary text-sm">Loading…</div>
          ) : error ? (
            <div className="p-4 text-status-danger text-sm">Error loading notes</div>
          ) : notes.length === 0 ? (
            <div className="p-4 text-text-secondary text-sm text-center">No notes yet</div>
          ) : (
            <div className="divide-y divide-border">
              {notes.map((note) => (
                <button
                  key={note.id}
                  onClick={() => handleSelectNote(note)}
                  className={`w-full text-left px-4 py-3 transition-colors ${
                    draft.id === note.id ? 'bg-accent/10 border-l-2 border-l-accent' : 'hover:bg-surface-raised border-l-2 border-l-transparent'
                  }`}
                >
                  <p className="text-sm text-text-primary font-medium truncate">{note.title}</p>
                  <p className="text-xs text-text-secondary truncate mt-0.5">{note.body || 'No content'}</p>
                </button>
              ))}
            </div>
          )}
        </div>
          </>
        )}
      </div>

      {/* Editor pane */}
      <div className="flex-1 flex flex-col min-w-0 bg-surface border border-border rounded-md shadow-md overflow-hidden">
        {draft.id === null ? (
          <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">
            Select a note, or create a new one.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border flex-shrink-0">
              <input
                type="text"
                placeholder="Note title..."
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="flex-1 bg-transparent text-text-primary text-base font-semibold placeholder:text-text-secondary focus:outline-none"
              />
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button
                  onClick={handleToggleDictation}
                  title="Voice input"
                  className={`p-1.5 rounded-sm transition-colors ${isListening ? 'bg-status-danger/20 text-status-danger' : 'hover:bg-surface-raised text-text-secondary hover:text-text-primary'}`}
                >
                  <Mic size={16} />
                </button>
                <button
                  onClick={handleReadAloud}
                  title="Read aloud"
                  className={`p-1.5 rounded-sm transition-colors ${isSpeaking ? 'bg-accent/20 text-accent' : 'hover:bg-surface-raised text-text-secondary hover:text-text-primary'}`}
                >
                  {isSpeaking ? <Square size={16} /> : <Volume2 size={16} />}
                </button>
                <button
                  onClick={() => setShowSymbolPicker(true)}
                  title="Insert symbol"
                  className="p-1.5 hover:bg-surface-raised rounded-sm transition-colors text-text-secondary hover:text-text-primary"
                >
                  <Sigma size={16} />
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  title="Save"
                  className="p-1.5 hover:bg-surface-raised rounded-sm transition-colors text-text-secondary hover:text-status-ok disabled:opacity-50"
                >
                  <Save size={16} />
                </button>
                {draft.id !== 'new' && (
                  <button
                    onClick={handleDelete}
                    title="Delete"
                    className="p-1.5 hover:bg-surface-raised rounded-sm transition-colors text-text-secondary hover:text-status-danger"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <textarea
                ref={bodyRef}
                placeholder="Start writing…"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                className="w-full h-full min-h-[300px] bg-transparent text-text-primary placeholder:text-text-secondary focus:outline-none resize-none leading-relaxed"
              />
            </div>

            <div className="px-4 py-2 border-t border-border flex-shrink-0">
              <div className="flex items-center gap-2 flex-wrap">
                {draft.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-1 bg-surface-raised border border-border rounded-sm text-xs text-text-secondary flex items-center gap-1"
                  >
                    <TagIcon size={10} />
                    {tag}
                    <button onClick={() => setDraft({ ...draft, tags: draft.tags.filter((t) => t !== tag) })} className="hover:text-text-primary">
                      <X size={10} />
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  placeholder="Add tag..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddTag(tagInput)}
                  className="px-2 py-1 bg-transparent text-text-primary text-xs placeholder:text-text-secondary focus:outline-none w-24"
                />
              </div>
            </div>
            {draft.id !== 'new' && originalNote && <NoteRevisionsPanel note={originalNote} onRestored={(restored) => setDraft({ id: restored.id, title: restored.title, body: restored.body, tags: restored.tags })} />}
          </>
        )}
      </div>

      {showSymbolPicker && (
        <SymbolPickerModal
          onInsert={insertSymbol}
          onClose={() => setShowSymbolPicker(false)}
        />
      )}
    </div>
  );
}
