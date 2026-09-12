import { Resource, getResourceDownloadUrl, getDocxHtml } from '../api/resources';
import {
  X, Download, ChevronLeft, ChevronRight, Repeat, Maximize2, Minimize2,
  ZoomIn, ZoomOut, RotateCcw, PanelRight, Pencil, Search,
  Image as ImageIcon, Video, Music, FileText, File as FileIcon, Folder, Link as LinkIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type WheelEvent } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface Props {
  resource: Resource;
  resources?: Resource[];
  onClose: () => void;
  onEdit?: (resource: Resource) => void;
}

type PaneContent = {
  text: string | null;
  docxHtml: string | null;
  loading: boolean;
  error: string | null;
};

function extension(r: Resource) {
  const name = r.name || r.original_filename || '';
  return name.split('.').pop()?.toLowerCase() || '';
}

function isMarkdownResource(r: Resource) {
  const ext = extension(r);
  return ext === 'md' || ext === 'markdown';
}

function isEditableResource(r: Resource) {
  const ext = extension(r);
  return ext === 'pdf' || isMarkdownResource(r) || ext === 'docx';
}

function iconForResource(r: Resource) {
  const ext = extension(r);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return <ImageIcon size={15} />;
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return <Video size={15} />;
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return <Music size={15} />;
  if (ext === 'pdf' || isMarkdownResource(r) || ext === 'docx') return <FileText size={15} />;
  if (r.kind === 'folder') return <Folder size={15} />;
  if (r.kind === 'link') return <LinkIcon size={15} />;
  return <FileIcon size={15} />;
}

function subtitleForResource(r: Resource) {
  return [r.kind, extension(r).toUpperCase()].filter(Boolean).join(' • ');
}

function usePaneContent(resource: Resource): PaneContent {
  const [text, setText] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const ext = extension(resource);
      setLoading(true);
      setError(null);
      setText(null);
      setDocxHtml(null);
      try {
        if (ext === 'docx') {
          const result = await getDocxHtml(resource.id);
          if (!cancelled) setDocxHtml(result.html);
        } else if (isMarkdownResource(resource) || ['txt', 'csv', 'json', 'xml', 'yaml', 'yml'].includes(ext)) {
          const response = await fetch(getResourceDownloadUrl(resource.id));
          if (!response.ok) throw new Error(`Unable to load resource (${response.status})`);
          if (!cancelled) setText(await response.text());
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load resource');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [resource.id]);

  return { text, docxHtml, loading, error };
}

export default function ResourceViewerModal({ resource, resources = [], onClose, onEdit }: Props) {
  const list = useMemo(() => (resources.length ? resources : [resource]), [resources, resource]);
  const initialIndex = Math.max(0, list.findIndex((r) => r.id === resource.id));
  const [leftId, setLeftId] = useState<string>(resource.id);
  const [rightId, setRightId] = useState<string | null>(list.length > 1 ? list[(initialIndex + 1) % list.length]?.id ?? null : null);
  const [isSplit, setIsSplit] = useState(() => localStorage.getItem('labos-resource-viewer-split') === '1');
  const [size, setSize] = useState<'medium' | 'large'>(() => (localStorage.getItem('labos-resource-viewer-size') as 'medium' | 'large') || 'medium');
  const [hoveredPane, setHoveredPane] = useState<'left' | 'right'>('left');
  const [pickerFor, setPickerFor] = useState<'left' | 'right' | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfPages, setPdfPages] = useState(0);
  const [rightPdfPage, setRightPdfPage] = useState(1);
  const [rightPdfPages, setRightPdfPages] = useState(0);

  const left = list.find((r) => r.id === leftId) || resource;
  const right = rightId ? list.find((r) => r.id === rightId) || null : null;
  const leftContent = usePaneContent(left);
  const rightContent = usePaneContent(right || left);

  useEffect(() => {
    localStorage.setItem('labos-resource-viewer-split', isSplit ? '1' : '0');
  }, [isSplit]);

  useEffect(() => {
    localStorage.setItem('labos-resource-viewer-size', size);
  }, [size]);

  useEffect(() => {
    setPdfPage(1);
    setPdfPages(0);
  }, [left.id]);

  useEffect(() => {
    setRightPdfPage(1);
    setRightPdfPages(0);
  }, [right?.id]);

  const stepList = (id: string, dir: 1 | -1) => {
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0 || list.length === 0) return id;
    return list[(idx + dir + list.length) % list.length].id;
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (pickerFor) {
        if (e.key === 'Escape') setPickerFor(null);
        return;
      }
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)) return;
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      if (!isSplit) setLeftId((id) => stepList(id, dir));
      else if (hoveredPane === 'left') setLeftId((id) => stepList(id, dir));
      else if (rightId) setRightId((id) => stepList(id, dir));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, isSplit, hoveredPane, pickerFor, rightId, list]);

  const containerSizeClass = size === 'large'
    ? 'w-[95vw] h-[95vh]'
    : isSplit
      ? 'w-[94vw] h-[88vh] max-w-[1600px]'
      : 'w-full h-full max-w-6xl max-h-[90vh]';

  const choose = (pane: 'left' | 'right', id: string) => {
    if (pane === 'left') setLeftId(id);
    else setRightId(id);
    setPickerFor(null);
    setPickerQuery('');
  };

  const filteredResources = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => `${r.name} ${r.original_filename || ''} ${r.file_type || ''}`.toLowerCase().includes(q));
  }, [list, pickerQuery]);

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom((z) => Math.max(0.25, Math.min(4, z + (e.deltaY < 0 ? 0.1 : -0.1))));
    }
  };

  const renderContent = (r: Resource, content: PaneContent, pane: 'left' | 'right') => {
    const ext = extension(r);
    const url = getResourceDownloadUrl(r.id);
    const isLeft = pane === 'left';
    const page = isLeft ? pdfPage : rightPdfPage;

    if (content.error) return <div className="p-6 text-sm text-red-300">{content.error}</div>;
    if (content.loading) return <div className="p-6 text-sm text-slate-400">Loading preview…</div>;

    if (ext === 'pdf') {
      return <div className="flex h-full items-center justify-center overflow-auto" onWheel={handleWheel}>
        <div style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}>
          <Document
            file={url as unknown as File}
            onLoadSuccess={({ numPages }) => isLeft ? setPdfPages(numPages) : setRightPdfPages(numPages)}
            onLoadError={() => { if (isLeft) setPdfPages(0); else setRightPdfPages(0); }}
          >
            <Page pageNumber={page} renderTextLayer renderAnnotationLayer />
          </Document>
        </div>
      </div>;
    }
    if (ext === 'docx' && content.docxHtml) return <div className="h-full overflow-auto bg-white p-8 text-black"><div dangerouslySetInnerHTML={{ __html: content.docxHtml }} /></div>;
    if (isMarkdownResource(r) && content.text !== null) return <pre className="h-full overflow-auto whitespace-pre-wrap p-6 text-sm leading-6 text-slate-200">{content.text}</pre>;
    if (['txt', 'csv', 'json', 'xml', 'yaml', 'yml'].includes(ext) && content.text !== null) return <pre className="h-full overflow-auto whitespace-pre-wrap p-6 text-sm leading-6 text-slate-200">{content.text}</pre>;
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return <div className="flex h-full items-center justify-center overflow-auto" onWheel={handleWheel}><img src={url} alt={r.name} style={{ transform: `scale(${zoom})`, maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} /></div>;
    if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return <div className="flex h-full items-center justify-center p-6"><video controls src={url} className="max-h-full max-w-full" /></div>;
    if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return <div className="flex h-full items-center justify-center p-6"><audio controls src={url} className="w-full max-w-xl" /></div>;
    if (r.kind === 'link') return <div className="flex h-full items-center justify-center p-8 text-center"><a href={r.url || url} target="_blank" rel="noreferrer" className="text-sm text-sky-300 underline">Open resource link</a></div>;
    return <div className="flex h-full items-center justify-center p-8 text-slate-400">No inline preview is available for this resource. Use Download to open it.</div>;
  };

  const renderPane = (r: Resource | null, content: PaneContent, pane: 'left' | 'right') => {
    if (!r) return <div className="flex h-full flex-1 items-center justify-center text-sm text-slate-500">Select a resource to compare.</div>;
    const isLeft = pane === 'left';
    const pages = isLeft ? pdfPages : rightPdfPages;
    const page = isLeft ? pdfPage : rightPdfPage;
    return <div className="flex min-w-0 flex-1 flex-col border border-slate-800 bg-slate-950" onMouseEnter={() => setHoveredPane(pane)}>
      <div className="flex min-h-12 items-center justify-between gap-2 border-b border-slate-800 px-3">
        <div className="flex min-w-0 items-center gap-2"><span className="text-slate-400">{iconForResource(r)}</span><div className="min-w-0"><div className="truncate text-sm font-medium text-slate-100">{r.name}</div><div className="text-[10px] text-slate-500">{subtitleForResource(r)}</div></div></div>
        <div className="flex shrink-0 items-center gap-1">
          {isSplit && <button className="rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800" onClick={() => setPickerFor(pane)}>Change</button>}
          {isEditableResource(r) && onEdit && <button className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800" onClick={() => onEdit(r)}><Pencil size={13} />Edit</button>}
          <a href={getResourceDownloadUrl(r.id)} download className="rounded p-1.5 text-slate-300 hover:bg-slate-800" title="Download"><Download size={14} /></a>
        </div>
      </div>
      <div className="min-h-0 flex-1">{renderContent(r, content, pane)}</div>
      {extension(r) === 'pdf' && pages > 0 && <div className="flex items-center justify-center gap-3 border-t border-slate-800 py-2 text-xs text-slate-400"><button disabled={page <= 1} onClick={() => isLeft ? setPdfPage((p) => p - 1) : setRightPdfPage((p) => p - 1)} className="disabled:opacity-30"><ChevronLeft size={15} /></button><span>{page} / {pages}</span><button disabled={page >= pages} onClick={() => isLeft ? setPdfPage((p) => p + 1) : setRightPdfPage((p) => p + 1)} className="disabled:opacity-30"><ChevronRight size={15} /></button></div>}
    </div>;
  };

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3">
    <div className={`${containerSizeClass} flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl`}>
      <div className="flex min-h-12 items-center justify-between border-b border-slate-800 px-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-100"><FileText size={15} />Resource Viewer</div>
        <div className="flex items-center gap-1">
          <button title="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.1))} className="rounded p-1.5 text-slate-300 hover:bg-slate-800"><ZoomIn size={15} /></button>
          <button title="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, z - 0.1))} className="rounded p-1.5 text-slate-300 hover:bg-slate-800"><ZoomOut size={15} /></button>
          <button title="Reset zoom" onClick={() => setZoom(1)} className="rounded p-1.5 text-slate-300 hover:bg-slate-800"><RotateCcw size={15} /></button>
          <button title="Toggle compare" onClick={() => { setIsSplit((v) => !v); setRightId((id) => id || (list.find((r) => r.id !== left.id)?.id ?? null)); }} className={`rounded p-1.5 ${isSplit ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`}><PanelRight size={15} /></button>
          <button title="Repeat selection" onClick={() => setRightId(left.id)} className="rounded p-1.5 text-slate-300 hover:bg-slate-800"><Repeat size={15} /></button>
          <button title="Resize" onClick={() => setSize((v) => v === 'medium' ? 'large' : 'medium')} className="rounded p-1.5 text-slate-300 hover:bg-slate-800">{size === 'large' ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
          <button title="Close" onClick={onClose} className="rounded p-1.5 text-slate-300 hover:bg-slate-800"><X size={16} /></button>
        </div>
      </div>
      <div className="min-h-0 flex flex-1 gap-2 p-2">{renderPane(left, leftContent, 'left')}{isSplit && renderPane(right, rightContent, 'right')}</div>
    </div>

    {pickerFor && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Choose resource">
      <div className="flex max-h-[75vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div><div className="text-sm font-semibold text-slate-100">Choose resource</div><div className="text-[11px] text-slate-500">Select the {pickerFor} pane resource</div></div>
          <button onClick={() => setPickerFor(null)} className="rounded p-1.5 text-slate-400 hover:bg-slate-800"><X size={16} /></button>
        </div>
        <div className="border-b border-slate-800 p-3">
          <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3"><Search size={14} className="text-slate-500" /><input autoFocus value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} placeholder="Search resources…" className="w-full bg-transparent py-2 text-sm text-slate-200 outline-none placeholder:text-slate-600" /></div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {filteredResources.length === 0 && <div className="p-8 text-center text-sm text-slate-500">No matching resources.</div>}
          {filteredResources.map((r) => <button key={r.id} onClick={() => choose(pickerFor, r.id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-slate-800 ${r.id === (pickerFor === 'left' ? left.id : right?.id) ? 'bg-slate-800/80 text-white' : 'text-slate-200'}`}><span className="text-slate-400">{iconForResource(r)}</span><span className="min-w-0 flex-1"><span className="block truncate">{r.name}</span><span className="block text-[10px] text-slate-500">{subtitleForResource(r)}</span></span></button>)}
        </div>
        <div className="flex justify-end border-t border-slate-800 px-4 py-3"><button onClick={() => setPickerFor(null)} className="rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">Cancel</button></div>
      </div>
    </div>}
  </div>;
}
