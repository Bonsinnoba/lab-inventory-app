import { useEffect, useRef, useState } from 'react';
import { Save, X, Upload, FileText, AlertTriangle } from 'lucide-react';
import { Resource, getResourceText, replaceResourceFile } from '../api/resources';
import { useToast } from '../contexts/ToastContext';

interface Props {
  resource: Resource;
  onClose: () => void;
  onSaved: (resource: Resource) => void;
}

function isMarkdown(resource: Resource) {
  const name = (resource.original_filename || resource.name || '').toLowerCase();
  return name.endsWith('.md') || name.endsWith('.markdown');
}

export default function ResourceEditorModal({ resource, onClose, onSaved }: Props) {
  const { showToast } = useToast();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const markdown = isMarkdown(resource);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (!markdown) {
      setLoading(false);
      return;
    }
    getResourceText(resource.id)
      .then(text => { if (!cancelled) setContent(text); })
      .catch((err: any) => { if (!cancelled) setError(err?.message || 'Unable to load Markdown file'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [resource.id, markdown]);

  const saveMarkdown = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/resources/${resource.id}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error || 'Failed to save Markdown');
      const updated = await response.json();
      onSaved(updated);
      showToast('Markdown saved');
      onClose();
    } catch (err: any) {
      showToast(err?.message || 'Failed to save Markdown', 'error');
    } finally {
      setSaving(false);
    }
  };

  const replacePdf = async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      showToast('Please choose a PDF file', 'error');
      return;
    }
    setSaving(true);
    try {
      const updated = await replaceResourceFile(resource.id, file);
      onSaved(updated);
      showToast('PDF replaced');
      onClose();
    } catch (err: any) {
      showToast(err?.message || 'Failed to replace PDF', 'error');
    } finally {
      setSaving(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[70]" onClick={onClose}>
      <div className="w-[95vw] h-[90vh] max-w-6xl bg-surface border border-border rounded-md overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-surface-raised">
          <div className="min-w-0">
            <h3 className="font-medium text-text-primary truncate">Edit {resource.name}</h3>
            <p className="text-xs text-text-secondary mt-0.5">{markdown ? 'Markdown source editor' : 'PDF file editor'}</p>
          </div>
          <div className="flex items-center gap-2">
            {markdown && (
              <button onClick={saveMarkdown} disabled={loading || saving || !!error} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg rounded-sm text-sm disabled:opacity-40">
                <Save size={15} /> {saving ? 'Saving…' : 'Save'}
              </button>
            )}
            {!markdown && (
              <>
                <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) void replacePdf(file); }} />
                <button onClick={() => fileRef.current?.click()} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg rounded-sm text-sm disabled:opacity-40">
                  <Upload size={15} /> {saving ? 'Saving…' : 'Replace PDF'}
                </button>
              </>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-surface rounded-sm text-text-secondary hover:text-text-primary" title="Close"><X size={18} /></button>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="h-full flex items-center justify-center text-text-secondary">Loading…</div>
          ) : error ? (
            <div className="h-full flex items-center justify-center"><div className="text-center max-w-md px-6"><FileText size={36} className="mx-auto mb-3 text-text-secondary" /><p className="text-text-primary mb-2">Unable to edit this file</p><p className="text-sm text-status-danger">{error}</p></div></div>
          ) : markdown ? (
            <div className="h-full flex flex-col">
              <div className="px-4 py-2 border-b border-border text-xs text-text-secondary">Edit the Markdown source directly. Changes are saved back to this LabOS resource.</div>
              <textarea value={content} onChange={e => setContent(e.target.value)} spellCheck={false} className="flex-1 w-full resize-none bg-bg text-text-primary font-mono text-sm leading-6 p-5 outline-none" />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center bg-surface-raised px-6">
              <div className="max-w-lg text-center">
                <AlertTriangle size={40} className="mx-auto mb-4 text-status-warn" />
                <h4 className="text-lg font-medium text-text-primary mb-2">Edit the PDF file</h4>
                <p className="text-sm text-text-secondary leading-6">Choose an edited PDF to replace this resource. The replacement keeps the same LabOS resource, attachments, category, description, and tags.</p>
                <p className="text-xs text-text-secondary mt-3">This preserves the original resource identity instead of creating a duplicate.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
