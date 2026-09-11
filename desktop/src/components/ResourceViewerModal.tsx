import { Resource, getResourceDownloadUrl, getResourceAccessUrl } from '../api/resources';
import {
  X, Download, ChevronLeft, ChevronRight, Repeat, Maximize2, Minimize2,
  ZoomIn, ZoomOut, RotateCcw, PanelRight,
  Image as ImageIcon, Video, Music, FileText, File as FileIcon, Folder, Link as LinkIcon,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
// Import the pdf.js worker through Vite's `?url` suffix so Vite
// resolves 'pdfjs-dist/...' through real node_modules resolution and
// hands back a URL to the actual built asset (works in both dev and
// prod). The previous `new URL('pdfjs-dist/...', import.meta.url)`
// approach looked right but silently resolved WRONG: Vite only
// rewrites `new URL(...)` calls for genuinely relative specifiers
// (./ or ../), not bare package names -- so it fell through to plain
// browser resolution relative to *this file's own folder*
// (src/components/pdfjs-dist/...), which doesn't exist, giving a 404
// and "fake worker" fallback regardless of the worker filename.
// (Also note: installed pdfjs-dist is supplied by react-pdf 10.x and uses the
// ESM worker build 'pdf.worker.min.mjs'. Keep this in sync with the
// installed React-PDF major version.)
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Remembered for the lifetime of the app session (module-level, so it
// survives closing/reopening the viewer, but resets on a real app
// restart since it's just an in-memory variable) -- once someone
// turns on compare view, it stays on for next time they open a
// viewer, until they turn it off again or restart the app.
let rememberedSplitMode = false;

// Same idea for the modal's size: 'medium' is the original compact
// size; 'large' fills 95% of the screen in both directions, which is
// a lot more comfortable for reading a multi-page PDF or a long .md
// file. Remembered across opens the same way split mode is.
let rememberedSize: 'medium' | 'large' = 'medium';

function iconForResource(r: Resource) {
  if (r.kind === 'folder') return Folder;
  if (r.kind === 'link') return LinkIcon;
  if (r.file_type === 'image') return ImageIcon;
  if (r.file_type === 'video') return Video;
  if (r.file_type === 'audio') return Music;
  if (r.file_type === 'pdf' || r.file_type === 'text' || r.file_type === 'document') return FileText;
  return FileIcon;
}

function subtitleForResource(r: Resource): string {
  if (r.kind === 'link') return r.url || 'Link';
  if (r.kind === 'folder') return 'Folder';
  return r.original_filename || r.file_type;
}

function isMarkdownResource(r: Resource): boolean {
  const name = (r.original_filename || r.name || '').toLowerCase();
  return name.endsWith('.md') || name.endsWith('.markdown');
}

interface ResourceViewerModalProps {
  resource: Resource;
  // The full list `resource` came from -- lets each pane offer a
  // picker of siblings to switch to, and lets arrow-key navigation
  // step through it. Optional: a caller with no natural list (a
  // single canvas block, a lazily opened folder file) can omit it,
  // and compare view / arrow-key stepping simply aren't offered.
  resources?: Resource[];
  onClose: () => void;
}

export default function ResourceViewerModal({ resource, resources, onClose }: ResourceViewerModalProps) {
  const list = resources && resources.length > 0 ? resources : [resource];
  const canCompare = list.length > 1;

  const [isSplit, setIsSplit] = useState(canCompare && rememberedSplitMode);
  const [size, setSize] = useState<'medium' | 'large'>(rememberedSize);
  const [leftId, setLeftId] = useState(resource.id);
  const [rightId, setRightId] = useState<string | null>(null);
  // Which pane (if any) is currently showing the "choose a resource"
  // picker instead of its normal preview.
  const [pickerFor, setPickerFor] = useState<'left' | 'right' | null>(
    canCompare && rememberedSplitMode ? 'right' : null
  );
  // Which pane the mouse is currently over -- used only to decide
  // which side ArrowLeft/ArrowRight should step through the resource
  // list. Zoom shortcuts are handled locally within each pane instead.
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
    // Cancelling the very first pick (entering compare with nothing
    // chosen yet for the right pane) backs out of compare mode
    // entirely, same as closing Chrome's "choose a tab" panel.
    if (pickerFor === 'right' && !rightId) {
      exitCompare();
    } else {
      setPickerFor(null);
    }
  };

  const toggleSize = () => {
    const next = size === 'medium' ? 'large' : 'medium';
    setSize(next);
    rememberedSize = next;
  };

  const stepList = (id: string, dir: 1 | -1): string => {
    const idx = list.findIndex((r) => r.id === id);
    const nextIdx = (idx + dir + list.length) % list.length;
    return list[nextIdx].id;
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Arrow-key browsing through the resource list, independent of
      // the "Switch" picker -- a fast way to step one at a time
      // instead of opening the list. Only fires when a pane isn't
      // mid-picker (nothing sensible to step through there) and,
      // in split view, only for whichever pane the mouse is over.
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      const targetsInputField =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement;
      if (targetsInputField) return;

      if (!isSplit) {
        if (pickerFor === 'left') return;
        setLeftId((id) => stepList(id, dir));
        return;
      }
      if (hoveredPane === 'left' && pickerFor !== 'left') {
        setLeftId((id) => stepList(id, dir));
      } else if (hoveredPane === 'right' && pickerFor !== 'right' && rightId) {
        setRightId((id) => stepList(id as string, dir));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, isSplit, hoveredPane, pickerFor, rightId, list]);

  const containerSizeClass =
    size === 'large'
      ? 'w-[95vw] h-[95vh]'
      : isSplit
        ? 'w-full h-full max-w-[95vw] max-h-[90vh]'
        : 'w-full h-full max-w-6xl max-h-[90vh]';

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div
        className={`relative ${containerSizeClass} bg-surface border border-border rounded-md overflow-hidden flex flex-col`}
      >
        <div className="bg-surface-raised border-b border-border px-3 py-1.5 flex items-center justify-between z-10 flex-shrink-0">
          <span className="text-xs text-text-secondary">
            {isSplit ? 'Split view: 2 resources' : canCompare ? `${list.length} resources` : ''}
          </span>
          <div className="flex items-center gap-1.5">
            {canCompare && (
              <button
                onClick={isSplit ? exitCompare : enterCompare}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm transition-colors text-xs font-medium ${
                  isSplit
                    ? 'bg-accent/15 text-accent'
                    : 'hover:bg-surface text-text-secondary hover:text-text-primary border border-border'
                }`}
                title={isSplit ? 'Exit split view' : 'Split view: compare two resources side by side'}
              >
                <PanelRight size={14} />
                {isSplit ? 'Exit split view' : 'Split view'}
              </button>
            )}
            <button
              onClick={toggleSize}
              className="p-1.5 hover:bg-surface rounded-sm transition-colors text-text-secondary hover:text-text-primary"
              title={size === 'large' ? 'Shrink to medium view' : 'Enlarge to 95% of the screen'}
            >
              {size === 'large' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-surface rounded-sm transition-colors text-text-secondary hover:text-text-primary"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {pickerFor === 'left' ? (
            <ResourcePicker
              resources={list.filter((r) => r.id !== rightId)}
              onPick={(r) => pickResource('left', r)}
              onCancel={cancelPicker}
            />
          ) : (
            <ResourcePane
              resource={leftResource}
              onSwitch={canCompare ? () => setPickerFor('left') : undefined}
              onMouseEnter={() => setHoveredPane('left')}
              onMouseLeave={() => setHoveredPane((p) => (p === 'left' ? null : p))}
            />
          )}

          {isSplit && (
            <>
              <div className="w-px bg-border flex-shrink-0" />
              {pickerFor === 'right' || !rightResource ? (
                <ResourcePicker
                  resources={list.filter((r) => r.id !== leftId)}
                  onPick={(r) => pickResource('right', r)}
                  onCancel={cancelPicker}
                />
              ) : (
                <ResourcePane
                  resource={rightResource}
                  onSwitch={() => setPickerFor('right')}
                  onMouseEnter={() => setHoveredPane('right')}
                  onMouseLeave={() => setHoveredPane((p) => (p === 'right' ? null : p))}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Mirrors Chrome's "choose a tab to add to split view" panel: a plain
// list of icon + name + subtitle, click one to open it in this pane.
function ResourcePicker({
  resources,
  onPick,
  onCancel,
}: {
  resources: Resource[];
  onPick: (r: Resource) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex-1 min-w-0 flex flex-col bg-surface-raised">
      <div className="flex items-center justify-end px-3 py-2 flex-shrink-0">
        <button
          onClick={onCancel}
          className="p-1.5 hover:bg-surface rounded-sm transition-colors text-text-secondary hover:text-text-primary"
          title="Cancel"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center overflow-hidden px-6 pt-2 pb-6 min-h-0">
        <h3 className="text-text-primary font-medium mb-4 flex-shrink-0">Choose a resource to add to split view</h3>
        <div className="w-full max-w-md min-h-0 flex-1 overflow-y-auto bg-surface border border-border rounded-md">
          {resources.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-text-secondary">
              No other resources to add.
            </div>
          ) : (
            resources.map((r) => {
              const Icon = iconForResource(r);
              return (
                <button
                  key={r.id}
                  onClick={() => onPick(r)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-raised transition-colors border-b border-border last:border-b-0 text-left"
                >
                  <Icon size={20} className="text-text-secondary flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary truncate">{r.name}</p>
                    <p className="text-xs text-text-secondary truncate">{subtitleForResource(r)}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

// One resource's worth of viewer chrome: its own mini-header (name,
// download, a "Switch" button that opens the picker to swap this
// pane's resource for another one) and its own preview state
// (PDF page/zoom, image zoom/pan -- all reset whenever the resource
// shown in this pane changes).
function ResourcePane({
  resource,
  onSwitch,
  onMouseEnter,
  onMouseLeave,
}: {
  resource: Resource;
  onSwitch?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0 });
  const isHoveredRef = useRef(false);
  const dragState = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Resolve a short-lived access URL for browser preview elements.
  useEffect(() => {
    let cancelled = false;
    setPreviewUrl(null);
    setPreviewError(null);
    const needsAccessUrl = resource.kind === 'file' &&
      ['image', 'video', 'audio', 'pdf', 'text'].includes(resource.file_type);
    if (!needsAccessUrl) {
      setIsLoading(false);
      return () => { cancelled = true; };
    }
    getResourceAccessUrl(resource.id)
      .then((url) => { if (!cancelled) setPreviewUrl(url); })
      .catch((err: any) => {
        if (!cancelled) {
          setPreviewError(typeof err?.message === 'string' ? err.message : 'Unable to access resource');
          setIsLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [resource.id, resource.kind, resource.file_type]);

  // Reset per-file preview state whenever this pane switches to a
  // different resource -- otherwise a PDF's page/zoom or an image's
  // pan position would carry over onto whatever's opened next.
  useEffect(() => {
    setIsLoading(true);
    setNumPages(null);
    setPdfError(null);
    setPreviewError(null);
    setPreviewUrl(null);
    setPageNumber(1);
    setZoom(1);
    setImgOffset({ x: 0, y: 0 });
  }, [resource.id]);

  // '+'/'-'/'0' zoom shortcuts, scoped to whichever pane the mouse is
  // actually over -- reads a ref rather than reacting to hover state
  // so this effect doesn't need to re-subscribe on every mouse move.
  useEffect(() => {
    const zoomable = resource.file_type === 'image' || resource.file_type === 'pdf';
    if (!zoomable) return;
    const handler = (e: KeyboardEvent) => {
      if (!isHoveredRef.current) return;
      if (e.key === '+' || e.key === '=') {
        setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
      } else if (e.key === '-') {
        setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
      } else if (e.key === '0') {
        setZoom(1);
        setImgOffset({ x: 0, y: 0 });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [resource.file_type]);

  const handleMouseEnter = () => {
    isHoveredRef.current = true;
    onMouseEnter?.();
  };
  const handleMouseLeave = () => {
    isHoveredRef.current = false;
    onMouseLeave?.();
  };

  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
  const resetZoom = () => {
    setZoom(1);
    setImgOffset({ x: 0, y: 0 });
  };

  const handleImageWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  };

  const handleImageMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      offsetX: imgOffset.x,
      offsetY: imgOffset.y,
    };
  };
  const handleImageMouseMove = (e: React.MouseEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setImgOffset({ x: dragState.current.offsetX + dx, y: dragState.current.offsetY + dy });
  };
  const stopImageDrag = () => {
    dragState.current = null;
  };

  const renderContent = () => {
    if (previewError) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-surface-raised">
          <div className="text-center max-w-md px-6">
            <p className="text-text-primary mb-2">Unable to open resource</p>
            <p className="text-text-secondary text-sm break-words">{previewError}</p>
          </div>
        </div>
      );
    }
    if (resource.kind === 'file' && ['image', 'video', 'audio', 'pdf', 'text'].includes(resource.file_type) && !previewUrl) {
      return <div className="w-full h-full bg-surface-raised" />;
    }
    if (resource.kind === 'link') {
      if (resource.file_type === 'youtube') {
        const videoId = extractYouTubeId(resource.url || '');
        if (videoId) {
          return (
            <div className="w-full h-full flex items-center justify-center bg-black">
              <iframe
                width="100%"
                height="100%"
                src={`https://www.youtube.com/embed/${videoId}`}
                title={resource.name}
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                onLoad={() => setIsLoading(false)}
              />
            </div>
          );
        }
      }
      return (
        <div className="w-full h-full flex items-center justify-center bg-surface-raised">
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent-dim underline"
          >
            Open {resource.url}
          </a>
        </div>
      );
    }

    if (resource.kind === 'folder') {
      return (
        <div className="w-full h-full flex items-center justify-center bg-surface-raised">
          <div className="text-center">
            <p className="text-text-primary mb-2">Folder contents cannot be previewed</p>
            <p className="text-text-secondary text-sm">Download to view files</p>
          </div>
        </div>
      );
    }

    if (resource.file_type === 'image') {
      return (
        <div
          className="w-full h-full flex items-center justify-center bg-black overflow-hidden select-none"
          onWheel={handleImageWheel}
          onMouseDown={handleImageMouseDown}
          onMouseMove={handleImageMouseMove}
          onMouseUp={stopImageDrag}
          onMouseLeave={stopImageDrag}
          onDoubleClick={resetZoom}
        >
          <img
            src={previewUrl || ''}
            alt={resource.name}
            draggable={false}
            className="max-w-full max-h-full object-contain"
            style={{
              transform: `translate(${imgOffset.x}px, ${imgOffset.y}px) scale(${zoom})`,
              cursor: zoom > 1 ? 'grab' : 'default',
              transition: dragState.current ? 'none' : 'transform 0.1s ease-out',
            }}
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setPreviewError('The resource could not be loaded. It may have been deleted or you may no longer have access.');
              setIsLoading(false);
            }}
          />
          <ZoomControls zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={resetZoom} />
        </div>
      );
    }

    if (resource.file_type === 'video') {
      return (
        <div className="w-full h-full flex items-center justify-center bg-black">
          <video
            src={previewUrl || ''}
            controls
            className="max-w-full max-h-full"
            onCanPlay={() => setIsLoading(false)}
            onError={() => {
              setPreviewError('The video could not be loaded. Check that the file still exists and that you have access to it.');
              setIsLoading(false);
            }}
          >
            Your browser does not support the video tag.
          </video>
        </div>
      );
    }

    if (resource.file_type === 'audio') {
      return (
        <div className="w-full h-full flex items-center justify-center bg-surface-raised">
          <audio
            src={previewUrl || ''}
            controls
            className="w-full max-w-md"
            onCanPlay={() => setIsLoading(false)}
            onError={() => {
              setPreviewError('The audio could not be loaded. Check that the file still exists and that you have access to it.');
              setIsLoading(false);
            }}
          >
            Your browser does not support the audio tag.
          </audio>
        </div>
      );
    }

    if (resource.file_type === 'text') {
      return (
        <TextPreview
          url={previewUrl || ''}
          isMarkdown={isMarkdownResource(resource)}
          onLoaded={() => setIsLoading(false)}
        />
      );
    }

    if (resource.file_type === 'pdf') {
      return (
        <div className="w-full h-full bg-surface-raised flex flex-col items-center overflow-auto py-8">
          <Document
            file={previewUrl || ''}
            onLoadSuccess={({ numPages: n }) => {
              setNumPages(n);
              setIsLoading(false);
            }}
            onLoadError={(err) => {
              // The default react-pdf fallback just says "Failed to
              // load PDF file" with no detail. Log the real error and
              // surface its message in the UI so a network/CORS/parse
              // failure can actually be diagnosed without devtools.
              console.error('PDF load error for resource', resource.id, resource.name, err);
              setPdfError(err?.message || String(err) || 'Unknown error');
              setIsLoading(false);
            }}
            loading={null}
            error={
              <div className="text-center max-w-md px-6">
                <p className="text-text-secondary mb-2">Failed to load PDF file.</p>
                {pdfError && (
                  <p className="text-xs text-text-secondary opacity-70 font-mono break-words">{pdfError}</p>
                )}
              </div>
            }
          >
            <Page
              pageNumber={pageNumber}
              scale={zoom}
              renderTextLayer={true}
              renderAnnotationLayer={true}
              className="shadow-lg"
            />
          </Document>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-surface border border-border rounded-md px-3 py-2 shadow-lg">
            {numPages && numPages > 1 && (
              <>
                <button
                  onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                  disabled={pageNumber <= 1}
                  className="p-1 hover:bg-surface-raised rounded-sm disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Previous page"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm text-text-secondary font-mono">
                  {pageNumber} / {numPages}
                </span>
                <button
                  onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
                  disabled={pageNumber >= numPages}
                  className="p-1 hover:bg-surface-raised rounded-sm disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Next page"
                >
                  <ChevronRight size={16} />
                </button>
                <div className="w-px h-4 bg-border" />
              </>
            )}
            <button
              onClick={zoomOut}
              disabled={zoom <= ZOOM_MIN}
              className="p-1 hover:bg-surface-raised rounded-sm disabled:opacity-30 disabled:cursor-not-allowed"
              title="Zoom out"
            >
              <ZoomOut size={16} />
            </button>
            <span className="text-sm text-text-secondary font-mono w-11 text-center">{Math.round(zoom * 100)}%</span>
            <button
              onClick={zoomIn}
              disabled={zoom >= ZOOM_MAX}
              className="p-1 hover:bg-surface-raised rounded-sm disabled:opacity-30 disabled:cursor-not-allowed"
              title="Zoom in"
            >
              <ZoomIn size={16} />
            </button>
            <button
              onClick={resetZoom}
              className="p-1 hover:bg-surface-raised rounded-sm"
              title="Reset zoom"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="w-full h-full flex items-center justify-center bg-surface-raised">
        <div className="text-center">
          <p className="text-text-primary mb-2">Preview not available</p>
          <p className="text-text-secondary text-sm">Download to view this file</p>
        </div>
      </div>
    );
  };

  const handleDownload = () => {
    const downloadUrlWithParam = getResourceDownloadUrl(resource.id, true);
    const link = document.createElement('a');
    link.href = downloadUrlWithParam;
    link.download = resource.original_filename || resource.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      className="flex-1 min-w-0 flex flex-col"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-1 border-b border-border bg-surface-raised flex-shrink-0">
        <h3 className="text-xs text-text-primary font-medium truncate min-w-0">{resource.name}</h3>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {onSwitch && (
            <button
              onClick={onSwitch}
              className="p-1 hover:bg-surface rounded-sm transition-colors text-text-secondary hover:text-text-primary"
              title="Switch to another resource"
            >
              <Repeat size={15} />
            </button>
          )}
          <button
            onClick={handleDownload}
            className="p-1 hover:bg-surface rounded-sm transition-colors text-text-secondary hover:text-text-primary"
            title="Download"
          >
            <Download size={15} />
          </button>
        </div>
      </div>
      <div className="flex-1 relative min-h-0">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface z-10">
            <div className="text-text-secondary text-sm">Loading...</div>
          </div>
        )}
        {renderContent()}
      </div>
    </div>
  );
}

function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-surface border border-border rounded-md px-3 py-2 shadow-lg">
      <button
        onClick={onZoomOut}
        disabled={zoom <= ZOOM_MIN}
        className="p-1 hover:bg-surface-raised rounded-sm disabled:opacity-30 disabled:cursor-not-allowed"
        title="Zoom out"
      >
        <ZoomOut size={16} />
      </button>
      <span className="text-sm text-text-secondary font-mono w-11 text-center">{Math.round(zoom * 100)}%</span>
      <button
        onClick={onZoomIn}
        disabled={zoom >= ZOOM_MAX}
        className="p-1 hover:bg-surface-raised rounded-sm disabled:opacity-30 disabled:cursor-not-allowed"
        title="Zoom in"
      >
        <ZoomIn size={16} />
      </button>
      <button onClick={onReset} className="p-1 hover:bg-surface-raised rounded-sm" title="Reset zoom">
        <RotateCcw size={14} />
      </button>
    </div>
  );
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

// Plain-text / markdown preview. .md/.markdown files render through a
// small dependency-free Markdown-to-JSX renderer (headers, bold/
// italic, inline & fenced code, links, lists, blockquotes, rules --
// the everyday subset, not full CommonMark: no tables or nested
// lists). Everything else (.txt) stays as monospace source.
function TextPreview({
  url,
  isMarkdown,
  onLoaded,
}: {
  url: string;
  isMarkdown: boolean;
  onLoaded: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(false);
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load file');
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) onLoaded();
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-surface-raised">
        <div className="text-center">
          <p className="text-text-primary mb-2">Preview not available</p>
          <p className="text-text-secondary text-sm">Download to view this file</p>
        </div>
      </div>
    );
  }

  if (content === null) {
    return <div className="w-full h-full bg-surface-raised" />;
  }

  if (isMarkdown) {
    return (
      <div className="w-full h-full bg-surface-raised overflow-auto">
        <div className="max-w-3xl mx-auto p-6">{renderMarkdown(content)}</div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-surface-raised overflow-auto">
      <pre className="whitespace-pre-wrap break-words font-mono text-sm text-text-primary p-6 max-w-3xl mx-auto">
        {content}
      </pre>
    </div>
  );
}

// --- Minimal, dependency-free Markdown renderer -------------------
// Covers the everyday subset used in lab notes: headers, bold/
// italic, inline & fenced code, links, lists, blockquotes, and rules.
// Not a full CommonMark implementation (no tables, no nested lists) --
// good enough to make .md notes readable without a new npm dependency.

const HEADING_SIZES: Record<number, string> = {
  1: 'text-2xl font-bold mt-5 mb-2',
  2: 'text-xl font-bold mt-4 mb-2',
  3: 'text-lg font-semibold mt-3 mb-1.5',
  4: 'text-base font-semibold mt-3 mb-1',
  5: 'text-sm font-semibold mt-2 mb-1',
  6: 'text-sm font-medium text-text-secondary mt-2 mb-1',
};

function parseInline(text: string, keyPrefix: string): (string | JSX.Element)[] {
  const nodes: (string | JSX.Element)[] = [];
  let remaining = text;
  let key = 0;
  const pattern = /(\*\*(.+?)\*\*|__(.+?)__|`([^`]+?)`|\[([^\]]+)\]\(([^)]+)\)|\*(.+?)\*|_(.+?)_)/;

  while (remaining.length > 0) {
    const match = pattern.exec(remaining);
    if (!match) {
      nodes.push(remaining);
      break;
    }
    const idx = match.index;
    if (idx > 0) nodes.push(remaining.slice(0, idx));

    if (match[2] !== undefined || match[3] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-${key++}`}>{match[2] ?? match[3]}</strong>);
    } else if (match[4] !== undefined) {
      nodes.push(
        <code key={`${keyPrefix}-${key++}`} className="bg-surface px-1 py-0.5 rounded text-[0.9em] font-mono">
          {match[4]}
        </code>
      );
    } else if (match[5] !== undefined) {
      nodes.push(
        <a
          key={`${keyPrefix}-${key++}`}
          href={match[6]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:text-accent-dim underline"
        >
          {match[5]}
        </a>
      );
    } else if (match[7] !== undefined || match[8] !== undefined) {
      nodes.push(<em key={`${keyPrefix}-${key++}`}>{match[7] ?? match[8]}</em>);
    }

    remaining = remaining.slice(idx + match[0].length);
  }

  return nodes;
}

function renderMarkdown(source: string): JSX.Element[] {
  const lines = source.split('\n');
  const blocks: JSX.Element[] = [];
  let i = 0;
  let blockKey = 0;

  const isFence = (l: string) => /^```/.test(l.trim());
  const isHeading = (l: string) => /^#{1,6}\s+/.test(l);
  const isRule = (l: string) => /^(---|\*\*\*|___)\s*$/.test(l.trim());
  const isQuote = (l: string) => /^>\s?/.test(l);
  const isBullet = (l: string) => /^\s*[-*+]\s+/.test(l);
  const isOrdered = (l: string) => /^\s*\d+\.\s+/.test(l);
  const isTableRow = (l: string) => /\|/.test(l) && l.trim().length > 0;
  const splitTableRow = (l: string): string[] => {
    let s = l.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  };
  const isTableSeparatorRow = (l: string): boolean => {
    const cells = splitTableRow(l);
    return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
  };

  while (i < lines.length) {
    const line = lines[i];

    if (isFence(line)) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(
        <pre key={`b-${blockKey++}`} className="bg-surface border border-border rounded-md p-3 overflow-x-auto my-3">
          <code className="text-sm font-mono text-text-primary">{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(
        <Tag key={`b-${blockKey}`} className={`${HEADING_SIZES[level]} text-text-primary`}>
          {parseInline(headingMatch[2], `h-${blockKey++}`)}
        </Tag>
      );
      i++;
      continue;
    }

    if (isRule(line)) {
      blocks.push(<hr key={`b-${blockKey++}`} className="border-border my-4" />);
      i++;
      continue;
    }

    // GFM-style table: a "| cell | cell |" header row immediately
    // followed by a "|---|---|" separator row.
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1])) {
      const headerCells = splitTableRow(line);
      i += 2; // skip header row + separator row
      const bodyRows: string[][] = [];
      while (i < lines.length && lines[i].trim() !== '' && isTableRow(lines[i])) {
        bodyRows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={`b-${blockKey}`} className="overflow-x-auto my-3">
          <table className="min-w-full border border-border text-sm border-collapse">
            <thead>
              <tr className="bg-surface">
                {headerCells.map((cell, idx) => (
                  <th
                    key={idx}
                    className="border border-border px-3 py-2 text-left font-semibold text-text-primary"
                  >
                    {parseInline(cell, `th-${blockKey}-${idx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rIdx) => (
                <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-surface-raised' : 'bg-surface'}>
                  {headerCells.map((_, cIdx) => (
                    <td key={cIdx} className="border border-border px-3 py-2 text-text-primary align-top">
                      {parseInline(row[cIdx] ?? '', `td-${blockKey}-${rIdx}-${cIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      blockKey++;
      continue;
    }

    if (isQuote(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && isQuote(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote key={`b-${blockKey}`} className="border-l-2 border-border pl-3 my-2 text-text-secondary italic">
          {quoteLines.map((l, idx) => (
            <p key={idx}>{parseInline(l, `bq-${blockKey}-${idx}`)}</p>
          ))}
        </blockquote>
      );
      blockKey++;
      continue;
    }

    if (isBullet(line)) {
      const items: string[] = [];
      while (i < lines.length && isBullet(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={`b-${blockKey}`} className="list-disc list-inside my-2 space-y-1 text-text-primary">
          {items.map((item, idx) => (
            <li key={idx}>{parseInline(item, `ul-${blockKey}-${idx}`)}</li>
          ))}
        </ul>
      );
      blockKey++;
      continue;
    }

    if (isOrdered(line)) {
      const items: string[] = [];
      while (i < lines.length && isOrdered(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={`b-${blockKey}`} className="list-decimal list-inside my-2 space-y-1 text-text-primary">
          {items.map((item, idx) => (
            <li key={idx}>{parseInline(item, `ol-${blockKey}-${idx}`)}</li>
          ))}
        </ol>
      );
      blockKey++;
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !isFence(lines[i]) &&
      !isHeading(lines[i]) &&
      !isRule(lines[i]) &&
      !isQuote(lines[i]) &&
      !isBullet(lines[i]) &&
      !isOrdered(lines[i]) &&
      !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1]))
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`b-${blockKey}`} className="text-text-primary my-2 leading-relaxed">
        {parseInline(paraLines.join(' '), `p-${blockKey++}`)}
      </p>
    );
  }

  return blocks;
}
