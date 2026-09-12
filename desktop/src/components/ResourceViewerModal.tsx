import { Resource, getResourceDownloadUrl, getResourceAccessUrl, getDocxHtml } from '../api/resources';
import {
  X, Download, ChevronLeft, ChevronRight, Repeat, Maximize2, Minimize2,
  ZoomIn, ZoomOut, RotateCcw, PanelRight, Pencil,
  Image as ImageIcon, Video, Music, FileText, File as FileIcon, Folder, Link as LinkIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent, type WheelEvent } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

let rememberedSplitMode = false;
let rememberedSize: 'medium' | 'large' = 'medium';

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

function extension(r: Resource) {
  return (r.original_filename || r.name || '').toLowerCase().split('.').pop() || '';
}

function isMarkdownResource(r: Resource) {
  const ext = extension(r);
  return ext === 'md' || ext === 'markdown';
}

function isEditableResource(r: Resource) {
  const ext = extension(r);
  return ext === 'pdf' || ext === 'md' || ext === 'markdown' || ext === 'docx';
}

function iconForResource(r: Resource) {
  if (r.kind === 'folder') return Folder;
  if (r.kind === 'link') return LinkIcon;
  if (r.file_type === 'image') return ImageIcon;
  if (r.file_type === 'video') return Video;
  if (r.file_type === 'audio') return Music;
  if (r.file_type === 'pdf' || r.file_type === 'text' || r.file_type === 'document') return FileText;
  return FileIcon;
}

function subtitleForResource(r: Resource) {
  if (r.kind === 'link') return r.url || 'Link';
  if (r.kind === 'folder') return 'Folder';
  return r.original_filename || r.file_type;
}

interface ResourceViewerModalProps {
  resource: Resource;
  resources?: Resource[];
  onClose: () => void;
  onEdit?: (resource: Resource) => void;
}

export default function ResourceViewerModal({ resource, resources, onClose, onEdit }: ResourceViewerModalProps) {
  const list = resources && resources.length > 0 ? resources : [resource];
  const canCompare = list.length > 1;
  const [isSplit, setIsSplit] = useState(canCompare && rememberedSplitMode);
  const [size, setSize] = useState<'medium' | 'large'>(rememberedSize);
  const [leftId, setLeftId] = useState(resource.id);
  const [rightId, setRightId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<'left' | 'right' | null>(
    canCompare && rememberedSplitMode ? 'right' : null
  );
  const [hoveredPane, setHoveredPane] = useState<'left' | 'right' | null>(null);

  const leftResource = list.find((r) => r.id === leftId) || resource;
  const rightResource = rightId ? list.find((r) => r.id === rightId) || null : null;

  const enterCompare = () => {
    setIsSplit(true);
    rememberedSplitMode = true;
    if (!rightId) setPickerFor('right');
  };
  const exitCompare = () => {
    setIsSplit(false);
    rememberedSplitMode = false;
    setPickerFor(null);
    setRightId(null);
  };
  const pickResource = (side: 'left' | 'right', chosen: Resource) => {
    if (side === 'left') setLeftId(chosen.id);
    else setRightId(chosen.id);
    setPickerFor(null);
  };
  const cancelPicker = () => {
    if (pickerFor === 'right' && !rightId) exitCompare();
    else setPickerFor(null);
  };
  const toggleSize = () => {
    const next = size === 'medium' ? 'large' : 'medium';
    setSize(next);
    rememberedSize = next;
  };
  const stepList = (id: string, dir: 1 | -1) => {
    const idx = list.findIndex((r) => r.id === id);
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
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLElement && active.isContentEditable) return;
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      if (!isSplit) {
        if (!pickerFor) setLeftId((id) => stepList(id, dir));
      } else if (hoveredPane === 'left' && pickerFor !== 'left') {
        setLeftId((id) => stepList(id, dir));
      } else if (hoveredPane === 'right' && pickerFor !== 'right' && rightId) {
        setRightId((id) => stepList(id, dir));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, isSplit, hoveredPane, pickerFor, rightId, list]);

  const containerSizeClass = size === 'large'
    ? 'w-[95vw] h-[95vh]'
    : isSplit
      ? 'w-full h-full max-w-[95vw] max-h-[90vh]'
      : 'w-full h-full max-w-6xl max-h-[90vh]';

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className={`relative ${containerSizeClass} bg-surface border border-border rounded-md overflow-hidden flex flex-col`}>
        <div className="bg-surface-raised border-b border-border px-3 py-1.5 flex items-center justify-between z-10 flex-shrink-0">
          <span className="text-xs text-text-secondary">{isSplit ? 'Split view: 2 resources' : canCompare ? `${list.length} resources` : ''}</span>
          <div className="flex items-center gap-1.5">
            {canCompare && (
              <button onClick={isSplit ? exitCompare : enterCompare} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-medium ${isSplit ? 'bg-accent/15 text-accent' : 'hover:bg-surface text-text-secondary hover:text-text-primary border border-border'}`} title={isSplit ? 'Exit split view' : 'Compare two resources'}>
                <PanelRight size={14} />{isSplit ? 'Exit split view' : 'Compare'}
              </button>
            )}
            <button onClick={toggleSize} className="p-1.5 hover:bg-surface rounded-sm text-text-secondary hover:text-text-primary" title={size === 'large' ? 'Shrink viewer' : 'Enlarge viewer'}>
              {size === 'large' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-surface rounded-sm text-text-secondary hover:text-text-primary" title="Close"><X size={18} /></button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {pickerFor === 'left' ? (
            <ResourcePicker resources={list.filter((r) => r.id !== rightId)} onPick={(r) => pickResource('left', r)} onCancel={cancelPicker} />
          ) : (
            <ResourcePane resource={leftResource} onSwitch={canCompare ? () => setPickerFor('left') : undefined} onEdit={onEdit} onMouseEnter={() => setHoveredPane('left')} onMouseLeave={() => setHoveredPane((p) => p === 'left' ? null : p)} />
          )}
          {isSplit && (
            <>
              <div className="w-px bg-border flex-shrink-0" />
              {pickerFor === 'right' || !rightResource ? (
                <ResourcePicker resources={list.filter((r) => r.id !== leftId)} onPick={(r) => pickResource('right', r)} onCancel={cancelPicker} />
              ) : (
                <ResourcePane resource={rightResource} onSwitch={() => setPickerFor('right')} onEdit={onEdit} onMouseEnter={() => setHoveredPane('right')} onMouseLeave={() => setHoveredPane((p) => p === 'right' ? null : p)} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ResourcePicker({ resources, onPick, onCancel }: { resources: Resource[]; onPick: (r: Resource) => void; onCancel: () => void }) {
  return (
    <div className="flex-1 min-w-0 flex flex-col bg-surface-raised">
      <div className="flex items-center justify-end px-3 py-2"><button onClick={onCancel} className="p-1.5 hover:bg-surface rounded-sm text-text-secondary hover:text-text-primary" title="Cancel"><X size={18} /></button></div>
      <div className="flex-1 flex flex-col items-center overflow-hidden px-6 pt-2 pb-6 min-h-0">
        <h3 className="text-text-primary font-medium mb-4">Choose a resource to compare</h3>
        <div className="w-full max-w-md min-h-0 flex-1 overflow-y-auto bg-surface border border-border rounded-md">
          {resources.length === 0 ? <div className="px-4 py-6 text-center text-sm text-text-secondary">No other resources to add.</div> : resources.map((r) => {
            const Icon = iconForResource(r);
            return <button key={r.id} onClick={() => onPick(r)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-raised border-b border-border last:border-b-0 text-left"><Icon size={20} className="text-text-secondary flex-shrink-0" /><div className="min-w-0"><p className="text-sm text-text-primary truncate">{r.name}</p><p className="text-xs text-text-secondary truncate">{subtitleForResource(r)}</p></div></button>;
          })}
        </div>
      </div>
    </div>
  );
}

function ResourcePane({ resource, onSwitch, onEdit, onMouseEnter, onMouseLeave }: { resource: Resource; onSwitch?: () => void; onEdit?: (resource: Resource) => void; onMouseEnter?: () => void; onMouseLeave?: () => void }) {
  const [isLoading, setIsLoading] = useState(true);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0 });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const dragState = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const hoverRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true); setPreviewUrl(null); setPreviewError(null); setDocxHtml(null); setNumPages(null); setPageNumber(1); setZoom(1); setImgOffset({ x: 0, y: 0 });
    const docx = extension(resource) === 'docx';
    if (docx) {
      getDocxHtml(resource.id).then((result) => { if (!cancelled) { setDocxHtml(safeHtml(result.html)); setIsLoading(false); } }).catch((err: any) => { if (!cancelled) { setPreviewError(err?.message || 'Unable to open DOCX'); setIsLoading(false); } });
      return () => { cancelled = true; };
    }
    const needsUrl = resource.kind === 'file' && ['image', 'video', 'audio', 'pdf', 'text'].includes(resource.file_type);
    if (!needsUrl) { setIsLoading(false); return () => { cancelled = true; }; }
    getResourceAccessUrl(resource.id).then((url) => { if (!cancelled) setPreviewUrl(url); }).catch((err: any) => { if (!cancelled) { setPreviewError(err?.message || 'Unable to access resource'); setIsLoading(false); } });
    return () => { cancelled = true; };
  }, [resource.id, resource.kind, resource.file_type]);

  useEffect(() => {
    const zoomable = resource.file_type === 'image' || resource.file_type === 'pdf';
    if (!zoomable) return;
    const handler = (e: KeyboardEvent) => {
      if (!hoverRef.current) return;
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
      else if (e.key === '-') setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
      else if (e.key === '0') { setZoom(1); setImgOffset({ x: 0, y: 0 }); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [resource.file_type]);

  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
  const resetZoom = () => { setZoom(1); setImgOffset({ x: 0, y: 0 }); };
  const handleImageWheel = (e: WheelEvent<HTMLDivElement>) => { e.preventDefault(); e.deltaY < 0 ? zoomIn() : zoomOut(); };
  const handleImageMouseDown = (e: MouseEvent<HTMLDivElement>) => { if (zoom <= 1) return; dragState.current = { startX: e.clientX, startY: e.clientY, offsetX: imgOffset.x, offsetY: imgOffset.y }; };
  const handleImageMouseMove = (e: MouseEvent<HTMLDivElement>) => { if (!dragState.current) return; setImgOffset({ x: dragState.current.offsetX + e.clientX - dragState.current.startX, y: dragState.current.offsetY + e.clientY - dragState.current.startY }); };
  const stopDrag = () => { dragState.current = null; };

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = getResourceDownloadUrl(resource.id, true);
    a.download = resource.original_filename || resource.name;
    document.body.appendChild(a); a.click(); a.remove();
  };

  const renderContent = () => {
    if (previewError) return <div className="w-full h-full flex items-center justify-center bg-surface-raised"><div className="text-center max-w-md px-6"><p className="text-text-primary mb-2">Unable to open resource</p><p className="text-text-secondary text-sm break-words">{previewError}</p></div></div>;
    if (extension(resource) === 'docx') return docxHtml ? <div className="w-full h-full overflow-auto bg-surface-raised p-6 md:p-10"><article className="mx-auto max-w-4xl min-h-full bg-white text-black shadow-lg px-8 py-10 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: docxHtml }} /></div> : <div className="w-full h-full bg-surface-raised" />;
    if (resource.kind === 'link') {
      if (resource.file_type === 'youtube') { const id = extractYouTubeId(resource.url || ''); if (id) return <div className="w-full h-full bg-black"><iframe width="100%" height="100%" src={`https://www.youtube.com/embed/${id}`} title={resource.name} frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen onLoad={() => setIsLoading(false)} /></div>; }
      return <div className="w-full h-full flex items-center justify-center bg-surface-raised"><a href={resource.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">Open {resource.url}</a></div>;
    }
    if (resource.kind === 'folder') return <div className="w-full h-full flex items-center justify-center bg-surface-raised"><div className="text-center"><p className="text-text-primary mb-2">Folder contents cannot be previewed</p><p className="text-text-secondary text-sm">Download to view files</p></div></div>;
    if (resource.file_type === 'image') return <div className="w-full h-full flex items-center justify-center bg-black overflow-hidden select-none" onWheel={handleImageWheel} onMouseDown={handleImageMouseDown} onMouseMove={handleImageMouseMove} onMouseUp={stopDrag} onMouseLeave={stopDrag} onDoubleClick={resetZoom}><img src={previewUrl || ''} alt={resource.name} draggable={false} className="max-w-full max-h-full object-contain" style={{ transform: `translate(${imgOffset.x}px, ${imgOffset.y}px) scale(${zoom})`, cursor: zoom > 1 ? 'grab' : 'default' }} onLoad={() => setIsLoading(false)} onError={() => { setPreviewError('The resource could not be loaded.'); setIsLoading(false); }} /><ZoomControls zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={resetZoom} /></div>;
    if (resource.file_type === 'video') return <div className="w-full h-full flex items-center justify-center bg-black"><video src={previewUrl || ''} controls className="max-w-full max-h-full" onCanPlay={() => setIsLoading(false)} /></div>;
    if (resource.file_type === 'audio') return <div className="w-full h-full flex items-center justify-center bg-surface-raised"><audio src={previewUrl || ''} controls className="w-full max-w-md" onCanPlay={() => setIsLoading(false)} /></div>;
    if (resource.file_type === 'text') return <TextPreview url={previewUrl || ''} isMarkdown={isMarkdownResource(resource)} onLoaded={() => setIsLoading(false)} />;
    if (resource.file_type === 'pdf') return <div className="w-full h-full bg-surface-raised flex flex-col items-center overflow-auto py-8"><Document file={previewUrl || ''} onLoadSuccess={({ numPages: n }) => { setNumPages(n); setIsLoading(false); }} onLoadError={() => setIsLoading(false)} loading={null}><Page pageNumber={pageNumber} scale={zoom} renderTextLayer renderAnnotationLayer className="shadow-lg" /></Document><div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-surface border border-border rounded-md px-3 py-2 shadow-lg">{numPages && numPages > 1 && <><button onClick={() => setPageNumber((p) => Math.max(1, p - 1))} disabled={pageNumber <= 1} className="p-1 hover:bg-surface-raised rounded-sm disabled:opacity-30"><ChevronLeft size={16} /></button><span className="text-sm text-text-secondary font-mono">{pageNumber} / {numPages}</span><button onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))} disabled={pageNumber >= numPages} className="p-1 hover:bg-surface-raised rounded-sm disabled:opacity-30"><ChevronRight size={16} /></button><div className="w-px h-4 bg-border" /></>}<ZoomControls zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={resetZoom} /></div></div>;
    return <div className="w-full h-full flex items-center justify-center bg-surface-raised"><div className="text-center"><p className="text-text-primary mb-2">Preview not available</p><p className="text-text-secondary text-sm">Download to view this file</p></div></div>;
  };

  return <div className="flex-1 min-w-0 flex flex-col" onMouseEnter={() => { hoverRef.current = true; onMouseEnter?.(); }} onMouseLeave={() => { hoverRef.current = false; onMouseLeave?.(); }}>
    <div className="flex items-center justify-between gap-2 px-2.5 py-1 border-b border-border bg-surface-raised flex-shrink-0">
      <h3 className="text-xs text-text-primary font-medium truncate min-w-0">{resource.name}</h3>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {isEditableResource(resource) && onEdit && <button onClick={() => onEdit(resource)} className="flex items-center gap-1 px-2 py-1 bg-accent text-bg rounded-sm text-[11px]" title="Edit resource"><Pencil size={13} />Edit</button>}
        {onSwitch && <button onClick={onSwitch} className="p-1 hover:bg-surface rounded-sm text-text-secondary hover:text-text-primary" title="Switch to another resource"><Repeat size={15} /></button>}
        <button onClick={handleDownload} className="p-1 hover:bg-surface rounded-sm text-text-secondary hover:text-text-primary" title="Download"><Download size={15} /></button>
      </div>
    </div>
    <div className="flex-1 relative min-h-0">
      {isLoading && <div className="absolute inset-0 flex items-center justify-center bg-surface z-10"><div className="text-text-secondary text-sm">Loading…</div></div>}
      {renderContent()}
    </div>
  </div>;
}

function ZoomControls({ zoom, onZoomIn, onZoomOut, onReset }: { zoom: number; onZoomIn: () => void; onZoomOut: () => void; onReset: () => void }) {
  return <div className="flex items-center gap-2 bg-surface border border-border rounded-md px-3 py-2 shadow-lg"><button onClick={onZoomOut} disabled={zoom <= ZOOM_MIN} className="p-1 hover:bg-surface-raised rounded-sm disabled:opacity-30" title="Zoom out"><ZoomOut size={16} /></button><span className="text-sm text-text-secondary font-mono w-11 text-center">{Math.round(zoom * 100)}%</span><button onClick={onZoomIn} disabled={zoom >= ZOOM_MAX} className="p-1 hover:bg-surface-raised rounded-sm disabled:opacity-30" title="Zoom in"><ZoomIn size={16} /></button><button onClick={onReset} className="p-1 hover:bg-surface-raised rounded-sm" title="Reset zoom"><RotateCcw size={14} /></button></div>;
}

function TextPreview({ url, isMarkdown, onLoaded }: { url: string; isMarkdown: boolean; onLoaded: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { let cancelled = false; setContent(null); setError(false); fetch(url).then((res) => { if (!res.ok) throw new Error('Failed to load file'); return res.text(); }).then((text) => { if (!cancelled) setContent(text); }).catch(() => { if (!cancelled) setError(true); }).finally(() => { if (!cancelled) onLoaded(); }); return () => { cancelled = true; }; }, [url]);
  if (error) return <div className="w-full h-full flex items-center justify-center bg-surface-raised text-text-secondary">Preview not available</div>;
  if (content === null) return <div className="w-full h-full bg-surface-raised" />;
  return <div className="w-full h-full bg-surface-raised overflow-auto"><div className="max-w-4xl mx-auto p-6">{isMarkdown ? renderMarkdown(content) : <pre className="whitespace-pre-wrap break-words font-mono text-sm text-text-primary">{content}</pre>}</div></div>;
}

function renderMarkdown(source: string): JSX.Element[] {
  return source.split('\n').map((line, i) => {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) { const Tag = `h${heading[1].length}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'; return <Tag key={i} className="font-semibold text-text-primary mt-4 mb-2">{heading[2]}</Tag>; }
    if (/^\s*[-*+]\s+/.test(line)) return <li key={i} className="ml-5 list-disc text-text-primary">{line.replace(/^\s*[-*+]\s+/, '')}</li>;
    if (/^>\s?/.test(line)) return <blockquote key={i} className="border-l-2 border-border pl-3 my-2 text-text-secondary italic">{line.replace(/^>\s?/, '')}</blockquote>;
    if (line.trim() === '') return <div key={i} className="h-2" />;
    return <p key={i} className="text-text-primary my-2 leading-relaxed">{line}</p>;
  });
}

function safeHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, form').forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) el.removeAttribute(attr.name);
      if ((attr.name === 'href' || attr.name === 'src') && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  });
  return doc.body.innerHTML;
}

function extractYouTubeId(url: string): string | null {
  const patterns = [/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/];
  for (const pattern of patterns) { const match = url.match(pattern); if (match) return match[1]; }
  return null;
}
