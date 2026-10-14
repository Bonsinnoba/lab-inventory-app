import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  Copy,
  FileText,
  Heading1,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  Save,
  Strikethrough,
  Underline,
  Undo2,
  Unlink,
  X,
} from 'lucide-react';
import {
  Resource,
  getDocxHtml,
  getResourceText,
  saveDocxCopy,
  saveResourceText,
  createPdfEditCopy,
  replaceResourceFile,
  isLocalResourceRuntime,
} from '../api/resources';
import { useToast } from '../contexts/ToastContext';
import MarkdownVersionHistory from './MarkdownVersionHistory';

interface Props {
  resource: Resource;
  onClose: () => void;
  onSaved: (resource: Resource) => void;
}

function extension(resource: Resource) {
  return (resource.original_filename || resource.name || '').toLowerCase().split('.').pop() || '';
}
function isMarkdown(resource: Resource) {
  return extension(resource) === 'md' || extension(resource) === 'markdown';
}
function isDocx(resource: Resource) {
  return extension(resource) === 'docx';
}
function isPdf(resource: Resource) {
  return resource.file_type === 'pdf' || extension(resource) === 'pdf';
}

interface ToolButtonProps {
  label: string;
  onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
  active?: boolean;
}

function ToolButton({ label, onMouseDown, children, active = false }: ToolButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={onMouseDown}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors ${
        active
          ? 'bg-accent text-bg'
          : 'text-text-secondary hover:bg-surface hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}

export default function ResourceEditorModal({ resource, onClose, onSaved }: Props) {
  const { showToast } = useToast();
  const markdown = isMarkdown(resource);
  const docx = isDocx(resource);
  const pdf = isPdf(resource);
  const [content, setContent] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const loadedRevision = useRef(resource.updated_at);
  const loadedContent = useRef('');
  const docxAttempt = useRef<{resourceId:string;revision?:string;html:string;requestId:string}|null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState('');
  const [replacement, setReplacement] = useState<File|null>(null);
  const [replacementProgress, setReplacementProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent('');
    loadedContent.current = '';
    loadedRevision.current = resource.updated_at;
    setReplacement(null);

    if (markdown) {
      getResourceText(resource.id, loadedRevision.current)
        .then(text => {
          if (!cancelled) {loadedContent.current=text;setContent(text);}
        })
        .catch((err: any) => {
          if (!cancelled) setError(err?.message || 'Unable to load Markdown file');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else if (docx) {
      getDocxHtml(resource.id, loadedRevision.current)
        .then(result => {
          if (!cancelled) {
            loadedContent.current=result.html;
            setContent(result.html);
            if (editorRef.current) editorRef.current.innerHTML = result.html;
          }
        })
        .catch((err: any) => {
          if (!cancelled) setError(err?.message || 'Unable to load DOCX file');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [resource.id, markdown, docx]);

  useEffect(() => {
    if (docx && editorRef.current && content) editorRef.current.innerHTML = content;
  }, [docx, content]);

  const runCommand = (command: string, value?: string) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(command, false, value);
    setContent(editorRef.current.innerHTML);
    setActiveTool(command);
  };

  const insertLink = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const url = window.prompt('Enter the URL');
    if (!url) return;
    runCommand('createLink', url);
  };

  const removeLink = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    runCommand('unlink');
  };

  const formatBlock = (tag: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    runCommand('formatBlock', tag);
  };

  const commandButton = (command: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    runCommand(command);
    setActiveTool(command);
  };

  const saveMarkdown = async () => {
    setSaving(true);
    try {
      const updated = await saveResourceText(resource.id, content, loadedRevision.current);
      onSaved(updated);
      showToast(isLocalResourceRuntime()?'Markdown saved on this PC and queued for sync':'Markdown saved');
      onClose();
    } catch (err: any) {
      showToast(err?.message || 'Failed to save Markdown', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveDocx = async () => {
    const html = editorRef.current?.innerHTML || content;
    setSaving(true);
    try {
      const previous=docxAttempt.current;
      if(!previous||previous.resourceId!==resource.id||previous.revision!==loadedRevision.current||previous.html!==html){
        docxAttempt.current={resourceId:resource.id,revision:loadedRevision.current,html,requestId:crypto.randomUUID()};
      }
      const created = await saveDocxCopy(resource.id, html, loadedRevision.current, docxAttempt.current!.requestId);
      onSaved(created);
      showToast(isLocalResourceRuntime()?'DOCX copy saved on this PC and queued for sync':'DOCX saved as a new copy');
      onClose();
    } catch (err: any) {
      showToast(err?.message || 'Failed to save DOCX copy', 'error');
    } finally {
      setSaving(false);
    }
  };

  const makePdfCopy = async () => {
    setSaving(true);
    try {
      const created = await createPdfEditCopy(resource.id);
      onSaved(created);
      showToast(isLocalResourceRuntime()?'PDF copy saved on this PC and queued for sync':'PDF edit copy created');
      onClose();
    } catch (err: any) {
      showToast(err?.message || 'Failed to create PDF copy', 'error');
    } finally {
      setSaving(false);
    }
  };

  const savePdfReplacement = async () => {
    if(!replacement)return;
    setSaving(true);setReplacementProgress(0);
    try{
      const updated=await replaceResourceFile(resource.id,replacement,loadedRevision.current,setReplacementProgress);
      onSaved(updated);showToast(isLocalResourceRuntime()?'PDF saved on this PC and queued for sync':'PDF replaced');onClose();
    }catch(err:any){showToast(err?.message||'Unable to save PDF; previous version preserved','error');}
    finally{setSaving(false);}
  };

  const requestClose = () => {
    if(saving)return;
    if((content!==loadedContent.current||replacement)&&!window.confirm('Close this editor and discard its unsaved changes? Previously saved versions will be kept.'))return;
    onClose();
  };

  const renderDocxTools = () => (
    <aside className="flex w-14 shrink-0 flex-col items-center border-r border-border bg-surface-raised py-2">
      <div className="flex flex-col items-center gap-1">
        <ToolButton label="Bold" active={activeTool === 'bold'} onMouseDown={commandButton('bold')}><Bold size={17} /></ToolButton>
        <ToolButton label="Italic" active={activeTool === 'italic'} onMouseDown={commandButton('italic')}><Italic size={17} /></ToolButton>
        <ToolButton label="Underline" active={activeTool === 'underline'} onMouseDown={commandButton('underline')}><Underline size={17} /></ToolButton>
        <ToolButton label="Strikethrough" active={activeTool === 'strikeThrough'} onMouseDown={commandButton('strikeThrough')}><Strikethrough size={17} /></ToolButton>
      </div>

      <div className="my-2 h-px w-8 bg-border" />

      <div className="flex flex-col items-center gap-1">
        <ToolButton label="Heading 1" active={activeTool === 'h1'} onMouseDown={formatBlock('h1')}><Heading1 size={17} /></ToolButton>
        <ToolButton label="Heading 2" active={activeTool === 'h2'} onMouseDown={formatBlock('h2')}><Heading2 size={17} /></ToolButton>
        <ToolButton label="Paragraph" active={activeTool === 'p'} onMouseDown={formatBlock('p')}><Pilcrow size={17} /></ToolButton>
        <ToolButton label="Quote" active={activeTool === 'blockquote'} onMouseDown={formatBlock('blockquote')}><Quote size={17} /></ToolButton>
      </div>

      <div className="my-2 h-px w-8 bg-border" />

      <div className="flex flex-col items-center gap-1">
        <ToolButton label="Bulleted list" active={activeTool === 'insertUnorderedList'} onMouseDown={commandButton('insertUnorderedList')}><List size={17} /></ToolButton>
        <ToolButton label="Numbered list" active={activeTool === 'insertOrderedList'} onMouseDown={commandButton('insertOrderedList')}><ListOrdered size={17} /></ToolButton>
      </div>

      <div className="my-2 h-px w-8 bg-border" />

      <div className="flex flex-col items-center gap-1">
        <ToolButton label="Align left" active={activeTool === 'justifyLeft'} onMouseDown={commandButton('justifyLeft')}><AlignLeft size={17} /></ToolButton>
        <ToolButton label="Align center" active={activeTool === 'justifyCenter'} onMouseDown={commandButton('justifyCenter')}><AlignCenter size={17} /></ToolButton>
        <ToolButton label="Align right" active={activeTool === 'justifyRight'} onMouseDown={commandButton('justifyRight')}><AlignRight size={17} /></ToolButton>
      </div>

      <div className="my-2 h-px w-8 bg-border" />

      <div className="flex flex-col items-center gap-1">
        <ToolButton label="Add link" onMouseDown={insertLink}><Link size={17} /></ToolButton>
        <ToolButton label="Remove link" onMouseDown={removeLink}><Unlink size={17} /></ToolButton>
        <ToolButton label="Undo" onMouseDown={commandButton('undo')}><Undo2 size={17} /></ToolButton>
        <ToolButton label="Redo" onMouseDown={commandButton('redo')}><Redo2 size={17} /></ToolButton>
        <ToolButton label="Clear formatting" onMouseDown={commandButton('removeFormat')}><Check size={17} /></ToolButton>
      </div>
    </aside>
  );

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80" onClick={requestClose}>
      <div className="w-[95vw] h-[90vh] max-w-6xl bg-surface border border-border rounded-md overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-surface-raised">
          <div className="min-w-0">
            <h3 className="font-medium text-text-primary truncate">Edit {resource.name}</h3>
            <p className="text-xs text-text-secondary mt-0.5">{markdown ? 'Markdown source editor' : docx ? 'DOCX document editor' : 'PDF edit copy'}</p>
          </div>
          <div className="flex items-center gap-2">
            {markdown && <button onClick={saveMarkdown} disabled={loading || saving || !!error} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg rounded-sm text-sm disabled:opacity-40"><Save size={15} /> {saving ? 'Saving…' : 'Save'}</button>}
            {docx && <button onClick={saveDocx} disabled={loading || saving || !!error} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg rounded-sm text-sm disabled:opacity-40"><Save size={15} /> {saving ? 'Saving…' : 'Save as Copy'}</button>}
            {pdf && <button onClick={makePdfCopy} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg rounded-sm text-sm disabled:opacity-40"><Copy size={15} /> {saving ? 'Creating…' : 'Create Edit Copy'}</button>}
            <button onClick={requestClose} disabled={saving} className="p-1.5 hover:bg-surface rounded-sm text-text-secondary hover:text-text-primary disabled:opacity-40" title="Close"><X size={18} /></button>
          </div>
        </div>

        {markdown&&isLocalResourceRuntime()&&<MarkdownVersionHistory key={resource.id} resourceId={resource.id} onUse={setContent} disabled={loading||saving}/>}
        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="h-full flex items-center justify-center text-text-secondary">Loading…</div>
          ) : error ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-md px-6">
                <FileText size={36} className="mx-auto mb-3 text-text-secondary" />
                <p className="text-text-primary mb-2">Unable to edit this file</p>
                <p className="text-sm text-status-danger">{error}</p>
              </div>
            </div>
          ) : markdown ? (
            <div className="h-full flex flex-col">
              <div className="px-4 py-2 border-b border-border text-xs text-text-secondary">{isLocalResourceRuntime()?'Saves stay on this PC and synchronize when connected. Conflicting server edits require review; saved versions are preserved.':'Edit the Markdown source directly. Saving requires a server connection.'}</div>
              <textarea value={content} onChange={e => setContent(e.target.value)} spellCheck={false} className="flex-1 w-full resize-none bg-bg text-text-primary font-mono text-sm leading-6 p-5 outline-none" />
            </div>
          ) : docx ? (
            <div className="h-full flex flex-col">
              <div className="px-4 py-2 border-b border-border text-xs text-text-secondary flex items-center gap-2"><FileText size={14} /><span>{isLocalResourceRuntime()?'Save as Copy creates a new DOCX on this PC and queues it for sync.':'Saving creates a new DOCX resource.'} The original stays unchanged. Complex Word features may not be preserved by this editor.</span></div>
              <div className="flex flex-1 min-h-0">
                {renderDocxTools()}
                <div ref={editorRef} contentEditable suppressContentEditableWarning onInput={() => setContent(editorRef.current?.innerHTML || '')} className="flex-1 min-w-0 overflow-auto bg-bg text-text-primary p-8 outline-none leading-7 prose prose-invert max-w-none" />
              </div>
            </div>
          ) : pdf ? (
            <div className="h-full flex items-center justify-center bg-surface-raised px-6">
              <div className="max-w-lg text-center">
                <Copy size={40} className="mx-auto mb-4 text-text-secondary" />
                <h4 className="text-lg font-medium text-text-primary mb-2">{resource.derived_from_resource_id?'Save an externally edited PDF':'Create an editable PDF copy'}</h4>
                <p className="text-sm text-text-secondary leading-6">LabOS will duplicate the original PDF into a new resource. The original stays untouched. The duplicated PDF can then be edited externally and re-uploaded to that copy.</p>
                <p className="text-xs text-text-secondary mt-3">{isLocalResourceRuntime()?'Requires a verified PDF on this PC and cached edit authority. The copy is saved locally and queued for synchronization; the original is unchanged.':'The original is preserved; creating the copy requires a server connection.'}</p>
                {resource.derived_from_resource_id&&<div className="mt-6 rounded-lg border border-border bg-bg p-4 text-left">
                  <label className="block text-sm text-text-primary" htmlFor="edited-pdf">Edited PDF file</label>
                  <input id="edited-pdf" type="file" accept=".pdf,application/pdf" disabled={saving} onChange={e=>setReplacement(e.target.files?.[0]||null)} className="mt-2 block w-full text-sm text-text-secondary"/>
                  <p className="mt-3 text-xs text-text-secondary">Replaces this copy's content, keeping its resource identity and filename. On desktop, previous saved bytes are retained and edits wait for any pending copy creation to synchronize.</p>
                  <button onClick={savePdfReplacement} disabled={!replacement||saving} className="mt-4 rounded-md bg-accent px-4 py-2 text-sm text-bg disabled:opacity-40">{saving?`Saving ${replacementProgress}%…`:'Save edited PDF'}</button>
                </div>}
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-text-secondary">This file type is not editable.</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
