import { useEffect, useMemo, useState, type WheelEvent } from 'react';
import { Resource, getResourceDownloadUrl, getDocxHtml } from '../api/resources';
import {
  X, Download, ChevronLeft, ChevronRight, Repeat, Maximize2, Minimize2,
  ZoomIn, ZoomOut, RotateCcw, PanelRight, Pencil,
  Image as ImageIcon, Video, Music, FileText, File as FileIcon, Folder, Link as LinkIcon,
} from 'lucide-react';
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

function usePaneContent(resource: Resource | null) {
  const [text, setText] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setDocxHtml(null);
    setError(null);
    if (!resource) return;

    const ext = extension(resource);
    const load = async () => {
      if (ext !== 'docx' && !isMarkdownResource(resource) && !['txt', 'csv', 'json', 'xml', 'yaml', 'yml'].includes(ext)) return;
      setLoading(true);
      try {
        if (ext === 'docx') {
          const result = await getDocxHtml(resource.id);
          if (!cancelled) setDocxHtml(result.html);
        } else {
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
    void load();
    return () => { cancelled = true; };
  }, [resource?.id]);

  return { text, docxHtml, loading, error };
}

function PaneContent({
  resource,
  zoom,
  pdfPage,
  setPdfPages,
  onWheel,
}: {
  resource: Resource | null;
  zoom: number;
  pdfPage: number;
  setPdfPages: (pages: number) => void;
  onWheel: (e: WheelEvent<HTMLDivElement>) => void;
}) {
  const content = usePaneContent(resource);
  if (!resource) return <div className="flex h-full items-center justify-center text-sm text-slate-500">Select a resource to compare.</div>;
  if (content.loading) return <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading preview…</div>;
  if (content.error) return <div className="flex h-full items-center justify-center p-6 text-center text-sm text-red-300">{content.error}</div>;

  const ext = extension(resource);
  const url = getResourceDownloadUrl(resource.id);
  if (ext === 'pdf') {
    return (
      <div className="flex h-full items-start justify-center overflow-auto p-3" onWheel={onWheel}>
        <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
          <Document file={url as unknown as File} onLoadSuccess={({ numPages }) => setPdfPages(numPages)} onLoadError={() => setPdfPages(0)}>
            <Page pageNumber={pdfPage} renderTextLayer renderAnnotationLayer />
          </Document>
        </div>
      </div>
    );
  }
  if (ext === 'docx' && content.docxHtml !== null) {
    return <div className="h-full overflow-auto bg-white p-8 text-black"><div dangerouslySetInnerHTML={{ __html: content.docxHtml }} /></div>;
  }
  if (isMarkdownResource(resource) && content.text !== null) {
    return <pre className="h-full overflow-auto whitespace-pre-wrap p-6 text-sm leading-6 text-slate-200">{content.text}</pre>;
  }
  if (['txt', 'csv', 'json', 'xml', 'yaml', 'yml'].includes(ext) && content.text !== null) {
    return <pre className="h-full overflow-auto whitespace-pre-wrap p-6 text-sm leading-6 text-slate-200">{content.text}</pre>;
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return <div className="flex h-full items-center justify-center overflow-auto p-4" onWheel={onWheel}><img src={url} alt={resource.name} style={{ transform: `scale(${zoom})`, maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /></div>;
  }
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return <div className="flex h-full items-center justify-center p-4"><video controls src={url} className="max-h-full max-w-full" /></div>;
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return <div className="flex h-full items-center justify-center p-6"><audio controls src={url} className="w-full max-w-xl" /></div>;
  if (resource.kind === 'link') return <div className="flex h-full items-center justify-center p-8 text-center"><a href={resource.url || url} target="_blank" rel="noreferrer" className="text-sm text-sky-300 underline">Open resource link</a></div>;
  return <div className="flex h-full items-center justify-center p-8 text-center text-sm text-slate-400">No inline preview is available for this resource. Use Download to open it.</div>;
}

export default function ResourceViewerModal({ resource, resources = [], onClose, onEdit }: Props) {
  const list = useMemo(() => resources.length ? resources : [resource], [resources, resource]);
  const initialIndex = Math.max(0, list.findIndex((r) => r.id === resource.id));
  const [leftId, setLeftId] = useState<string | null>(resource.id);
  const [rightId, setRightId] = useState<string | null>(list.length > 1 ? list[(initialIndex + 1) % list.length]?.id ?? null : null);
  const [isSplit, setIsSplit] = useState(() => localStorage.getItem('labos-resource-viewer-split') === '1');
  const [size, setSize] = useState<'medium' | 'large'>(() => (localStorage.getItem('labos-resource-viewer-size') as 'medium' | 'large') || 'medium');
  const [hoveredPane, setHoveredPane] = useState<'left' | 'right'>('left');
  const [pickerFor, setPickerFor] = useState<'left' | 'right' | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [leftZoom, setLeftZoom] = useState(1);
  const [rightZoom, setRightZoom] = useState(1);
  const [leftPdfPage, setLeftPdfPage] = useState(1);
  const [rightPdfPage, setRightPdfPage] = useState(1);
  const [leftPdfPages, setLeftPdfPages] = useState(0);
  const [rightPdfPages, setRightPdfPages] = useState(0);

  const left = list.find((r) => r.id === leftId) || resource;
  const right = rightId ? list.find((r) => r.id === rightId) || null : null;

  useEffect(() => localStorage.setItem('labos-resource-viewer-split', isSplit ? '1' : '0'), [isSplit]);
  useEffect(() => localStorage.setItem('labos-resource-viewer-size', size), [size]);
  useEffect(() => { setLeftPdfPage(1); setLeftPdfPages(0); setLeftZoom(1); }, [left.id]);
  useEffect(() => { setRightPdfPage(1); setRightPdfPages(0); setRightZoom(1); }, [right?.id]);

  const stepList = (id: string, dir: 1 | -1) => {
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0 || list.length === 0) return id;
    return list[(idx + dir + list.length) % list.length].id;
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (pickerFor) { if (e.key === 'Escape') setPickerFor(null); return; }
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)) return;
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      if (!isSplit || hoveredPane === 'left') setLeftId((id) => id ? stepList(id, dir) : id);
      else setRightId((id) => id ? stepList(id, dir) : id);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, isSplit, hoveredPane, pickerFor, list]);

  const choose = (pane: 'left' | 'right', id: string) => {
    if (pane === 'left') setLeftId(id); else setRightId(id);
    setPickerFor(null);
    setPickerQuery('');
  };

  const filtered = list.filter((r) => `${r.name || ''} ${r.original_filename || ''}`.toLowerCase().includes(pickerQuery.toLowerCase()));
  const zoomFor = (pane: 'left' | 'right') => pane === 'left' ? leftZoom : rightZoom;
  const setZoomFor = (pane: 'left' | 'right', value: number) => pane === 'left' ? setLeftZoom(value) : setRightZoom(value);
  const wheelFor = (pane: 'left' | 'right') => (e: WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoomFor(pane, Math.max(0.25, Math.min(4, zoomFor(pane) + (e.deltaY < 0 ? 0.1 : -0.1))));
  };

  const renderPane = (r: Resource | null, pane: 'left' | 'right') => {
    const isLeft = pane === 'left';
    const pdfPage = isLeft ? leftPdfPage : rightPdfPage;
    const pdfPages = isLeft ? leftPdfPages : rightPdfPages;
    const setPdfPages = isLeft ? setLeftPdfPages : setRightPdfPages;
    const setPdfPage = isLeft ? setLeftPdfPage : setRightPdfPage;
    const zoom = zoomFor(pane);
    return (
      <div className="flex min-w-0 min-h-0 flex-1 flex-col border border-slate-800 bg-slate-950" onMouseEnter={() => setHoveredPane(pane)}>
        <div className="flex min-h-12 items-center justify-between gap-2 border-b border-slate-800 px-3">
          <div className="flex min-w-0 items-center gap-2"><span className="text-slate-400">{r ? iconForResource(r) : <FileText size={15} />}</span><div className="min-w-0"><div className="truncate text-sm font-medium text-slate-100">{r?.name || 'Choose a resource'}</div><div className="text-[10px] text-slate-500">{r ? subtitleForResource(r) : 'Compare pane'}</div></div></div>
          <div className="flex shrink-0 items-center gap-1">
            <button className="rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800" onClick={() => setPickerFor(pane)}>{r ? 'Change' : 'Choose'}</button>
            {r && isEditableResource(r) && onEdit && <button className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800" onClick={() => onEdit(r)}><Pencil size={13} />Edit</button>}
            {r && <a href={getResourceDownloadUrl(r.id)} download className="rounded p-1.5 text-slate-300 hover:bg-slate-800" title="Download"><Download size={14} /></a>}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <PaneContent resource={r} zoom={zoom} pdfPage={pdfPage} setPdfPages={setPdfPages} onWheel={wheelFor(pane)} />
        </div>
        {r && extension(r) === 'pdf' && pdfPages > 0 && <div className="flex items-center justify-center gap-3 border-t border-slate-800 py-2 text-xs text-slate-400"><button disabled={pdfPage <= 1} onClick={() => setPdfPage((p) => p - 1)} className="disabled:opacity-30"><ChevronLeft size={15} /></button><span>{pdfPage} / {pdfPages}</span><button disabled={pdfPage >= pdfPages} onClick={() => setPdfPage((p) => p + 1)} className="disabled:opacity-30"><ChevronRight size={15} /></button></div>}
      </div>
    );
  };

  const containerSizeClass = size === 'large' ? 'w-[95vw] h-[95vh]' : 'w-full h-full max-w-6xl max-h-[90vh]';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3">
      <div className={`${containerSizeClass} flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl`}>
        <div className="flex min-h-12 items-center justify-between border-b border-slate-800 px-3">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-100"><FileText size={15} />Resource Viewer</div>
          <div className="flex items-center gap-1">
            <button title="Zoom in" onClick={() => setZoomFor(hoveredPane, Math.min(4, zoomFor(hoveredPane) + 0.1))} className="rounded p-1.5 text-slate-300 hover:bg-slate-800"><ZoomIn size={15} /></button>
            <button title="Zoom out" onClick={() => setZoomFor(hoveredPane, Math.max(0.25, zoomFor(hoveredPane) - 0.1))} className="rounded p-1.5 text-slate-300 hover:bg-slate-800"><ZoomOut size={15} /></button>
            <button title="Reset zoom" onClick={() => setZoomFor(hoveredPane, 1)} className="rounded p-1.5 text-slate-300 hover:bg-slate-800"><RotateCcw size={15} /></button>
            <button title="Toggle compare" onClick={() => { setIsSplit((v) => !v); setRightId((id) => id || (list.find((r) => r.id !== left.id)?.id ?? null)); }} className={`rounded p-1.5 ${isSplit ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`}><PanelRight size={15} /></button>
            <button title="Repeat selection" onClick={() => setRightId(left.id)} className="rounded p-1.5 text-slate-300 hover:bg-slate-800"><Repeat size={15} /></button>
            <button title="Resize" onClick={() => setSize((v) => v === 'medium' ? 'large' : 'medium')} className="rounded p-1.5 text-slate-300 hover:bg-slate-800">{size === 'large' ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
            <button title="Close" onClick={onClose} className="rounded p-1.5 text-slate-300 hover:bg-slate-800"><X size={16} /></button>
          </div>
        </div>
        <div className="min-h-0 flex flex-1 gap-2 p-2">{renderPane(left, 'left')}{isSplit && renderPane(right, 'right')}</div>
        {pickerFor && <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/55 p-6"><div className="max-h-[75vh] w-full max-w-xl overflow-hidden rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-2xl" role="dialog" aria-modal="true"><div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium text-slate-100">Choose resource for {pickerFor}</span><button onClick={() => setPickerFor(null)} className="rounded p-1 text-slate-400 hover:bg-slate-800"><X size={15} /></button></div><input autoFocus value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} placeholder="Search resources" className="mb-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500" /><div className="max-h-[58vh] space-y-1 overflow-auto">{filtered.map((r) => <button key={r.id} onClick={() => choose(pickerFor, r.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"><span className="text-slate-400">{iconForResource(r)}</span><span className="min-w-0 flex-1 truncate">{r.name || r.original_filename}</span><span className="text-[10px] text-slate-500">{extension(r).toUpperCase()}</span></button>)}{filtered.length === 0 && <div className="py-8 text-center text-sm text-slate-500">No matching resources.</div>}</div></div></div>}
      </div>
    </div>
  );
}
