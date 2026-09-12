import { Resource, getResourceDownloadUrl, getDocxHtml } from '../api/resources';
import {
  X, Download, ChevronLeft, ChevronRight, Repeat, Maximize2, Minimize2,
  ZoomIn, ZoomOut, RotateCcw, PanelRight, Pencil,
  Image as ImageIcon, Video, Music, FileText, File as FileIcon, Folder, Link as LinkIcon,
} from 'lucide-react';
import { useEffect, useState, type WheelEvent } from 'react';
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

export default function ResourceViewerModal({ resource, resources = [], onClose, onEdit }: Props) {
  const list = resources.length ? resources : [resource];
  const initialIndex = Math.max(0, list.findIndex((r) => r.id === resource.id));
  const [leftId, setLeftId] = useState<string | null>(resource.id);
  const [rightId, setRightId] = useState<string | null>(list.length > 1 ? list[(initialIndex + 1) % list.length]?.id ?? null : null);
  const [isSplit, setIsSplit] = useState(() => localStorage.getItem('labos-resource-viewer-split') === '1');
  const [size, setSize] = useState<'medium' | 'large'>(() => (localStorage.getItem('labos-resource-viewer-size') as 'medium' | 'large') || 'medium');
  const [hoveredPane, setHoveredPane] = useState<'left' | 'right'>('left');
  const [pickerFor, setPickerFor] = useState<'left' | 'right' | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfPages, setPdfPages] = useState(0);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const left = list.find((r) => r.id === leftId) || resource;
  const right = rightId ? list.find((r) => r.id === rightId) || null : null;

  useEffect(() => {
    localStorage.setItem('labos-resource-viewer-split', isSplit ? '1' : '0');
  }, [isSplit]);

  useEffect(() => {
    localStorage.setItem('labos-resource-viewer-size', size);
  }, [size]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const r = left;
      const ext = extension(r);
      setLoadingContent(true);
      setError(null);
      setDocxHtml(null);
      setText(null);
      setPdfPage(1);
      try {
        if (ext === 'docx') {
          const result = await getDocxHtml(r.id);
          if (!cancelled) setDocxHtml(result.html);
        } else if (isMarkdownResource(r) || ['txt', 'csv', 'json', 'xml', 'yaml', 'yml'].includes(ext)) {
          const response = await fetch(getResourceDownloadUrl(r.id));
          if (!response.ok) throw new Error(`Unable to load resource (${response.status})`);
          if (!cancelled) setText(await response.text());
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load resource');
      } finally {
        if (!cancelled) setLoadingContent(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [left.id]);

  const stepList = (id: string, dir: 1 | -1) => {
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0 || list.length === 0) return id;
    return list[(idx + dir + list.length) % list.length].id;
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)) return;
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      if (!isSplit) {
        if (!pickerFor) setLeftId((id) => id ? stepList(id, dir) : id);
      } else if (hoveredPane === 'left' && pickerFor !== 'left') {
        setLeftId((id) => id ? stepList(id, dir) : id);
      } else if (hoveredPane === 'right' && pickerFor !== 'right') {
        setRightId((id) => id ? stepList(id, dir) : id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, isSplit, hoveredPane, pickerFor, list]);

  const containerSizeClass = size === 'large'
    ? 'w-[95vw] h-[95vh]'
    : isSplit
      ? 'w-full h-full max-w-[95vw] max-h-[90vh]'
      : 'w-full h-full max-w-6xl max-h-[90vh]';

  const choose = (pane: 'left' | 'right', id: string) => {
    if (pane === 'left') setLeftId(id);
    else setRightId(id);
    setPickerFor(null);
  };

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom((z) => Math.max(0.25, Math.min(4, z + (e.deltaY < 0 ? 0.1 : -0.1))));
    }
  };

  const renderContent = (r: Resource) => {
    const ext = extension(r);
    const url = getResourceDownloadUrl(r.id);
    const isLeft = r.id === left.id;
    if (error && isLeft) return <div className="p-6 text-sm text-red-300">{error}</div>;
    if (loadingContent && isLeft) return <div className="p-6 text-sm text-slate-400">Loading preview…</div>;

    if (ext === 'pdf') {
      return <div className="flex h-full items-center justify-center overflow-auto" onWheel={handleWheel}>
        <div style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}>
          <Document file={url as unknown as File} onLoadSuccess={({ numPages }) => setPdfPages(numPages)} onLoadError={() => setError('Unable to load PDF')}>
            <Page pageNumber={pdfPage} renderTextLayer renderAnnotationLayer />
          </Document>
        </div>
      </div>;
    }
    if (ext === 'docx' && docxHtml && isLeft) return <div className="h-full overflow-auto bg-white p-8 text-black"><div dangerouslySetInnerHTML={{ __html: docxHtml }} /></div>;
    if (isMarkdownResource(r) && text !== null && isLeft) return <pre className="h-full overflow-auto whitespace-pre-wrap p-6 text-sm leading-6 text-slate-200">{text}</pre>;
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return <div className="flex h-full items-center justify-center overflow-auto" onWheel={handleWheel}><img src={url} alt={r.name} style={{ transform: `scale(${zoom})`, maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} /></div>;
    if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return <div className="flex h-full items-center justify-center p-6"><video controls src={url} className="max-h-full max-w-full" /></div>;
    if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return <div className="flex h-full items-center justify-center p-6"><audio controls src={url} className="w-full max-w-xl" /></div>;
    if (r.kind === 'link') return <div className="flex h-full items-center justify-center p-8 text-center"><a href={r.url || url} target="_blank" rel="noreferrer" className="text-sm text-sky-300 underline">Open resource link</a></div>;
    return <div className="flex h-full items-center justify-center p-8 text-slate-400">No inline preview is available for this resource. Use Download to open it.</div>;
  };

  const renderPane = (r: Resource | null, pane: 'left' | 'right') => {
    if (!r) return <div className="flex h-full items-center justify-center text-sm text-slate-500">Select a resource to compare.</div>;
    const active = r.id === left.id && pane === 'left';
    return <div className="flex min-w-0 flex-1 flex-col border border-slate-800 bg-slate-950" onMouseEnter={() => setHoveredPane(pane)}>
      <div className="flex min-h-12 items-center justify-between gap-2 border-b border-slate-800 px-3">
        <div className="flex min-w-0 items-center gap-2"><span className="text-slate-400">{iconForResource(r)}</span><div className="min-w-0"><div className="truncate text-sm font-medium text-slate-100">{r.name}</div><div className="text-[10px] text-slate-500">{subtitleForResource(r)}</div></div></div>
        <div className="flex shrink-0 items-center gap-1">
          <button className="rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800" onClick={() => setPickerFor(pane)}>{active ? 'Change' : 'Choose'}</button>
          {isEditableResource(r) && onEdit && <button className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800" onClick={() => onEdit(r)}><Pencil size={13} />Edit</button>}
          <a href={getResourceDownloadUrl(r.id)} download className="rounded p-1.5 text-slate-300 hover:bg-slate-800" title="Download"><Download size={14} /></a>
        </div>
      </div>
      <div className="min-h-0 flex-1">{renderContent(r)}</div>
      {pane === 'left' && extension(r) === 'pdf' && pdfPages > 0 && <div className="flex items-center justify-center gap-3 border-t border-slate-800 py-2 text-xs text-slate-400"><button disabled={pdfPage <= 1} onClick={() => setPdfPage((p) => p - 1)} className="disabled:opacity-30"><ChevronLeft size={15} /></button><span>{pdfPage} / {pdfPages}</span><button disabled={pdfPage >= pdfPages} onClick={() => setPdfPage((p) => p + 1)} className="disabled:opacity-30"><ChevronRight size={15} /></button></div>}
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
      <div className="min-h-0 flex flex-1 gap-2 p-2">{renderPane(left, 'left')}{isSplit && renderPane(right, 'right')}</div>
      {pickerFor && <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-6"><div className="max-h-[70vh] w-full max-w-lg overflow-auto rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-2xl"><div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium text-slate-100">Choose resource</span><button onClick={() => setPickerFor(null)} className="rounded p-1 text-slate-400 hover:bg-slate-800"><X size={15} /></button></div>{list.map((r) => <button key={r.id} onClick={() => choose(pickerFor, r.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"><span className="text-slate-400">{iconForResource(r)}</span><span className="min-w-0 flex-1 truncate">{r.name}</span><span className="text-[10px] text-slate-500">{subtitleForResource(r)}</span></button>)}</div></div>}
    </div>
  </div>;
}
