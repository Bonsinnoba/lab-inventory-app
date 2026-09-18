import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCanvas, createBlock, updateBlock, deleteBlock, createConnector, deleteConnector, CanvasData, CanvasBlock } from '../api/canvas';
import { getResource, getResourceAccessUrl, Resource } from '../api/resources';
import { Plus, X, Image as ImageIcon, Video as VideoIcon, FileText, Music, Link as LinkIcon, Cable, ZoomIn, ZoomOut, Maximize2, Grid, MousePointer2, Trash2, RotateCcw, PanelRight, Search, Crosshair } from 'lucide-react';
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import AddBlockModal from './AddBlockModal';
import ResourceViewerModal from './ResourceViewerModal';
import FolderBrowserModal from './FolderBrowserModal';

interface ProjectCanvasProps { projectId: string; }

const MIN_WIDTH = 120;
const MIN_HEIGHT = 80;
const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 200;
const CANVAS_SIZE = { width: 2400, height: 1600 };
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 1.6;

const TYPE_ICON: Record<string, typeof ImageIcon> = {
  text: FileText, image: ImageIcon, video: VideoIcon, pdf: FileText, audio: Music, link: LinkIcon, folder: FileText,
};

const TYPE_LABEL: Record<string, string> = {
  text: 'Note', image: 'Image', video: 'Video', pdf: 'PDF', audio: 'Audio', link: 'Link', folder: 'Folder',
};

function BlockContent({ block, onOpen, connectMode }: { block: CanvasBlock; onOpen: () => void; connectMode: boolean }) {
  const { data: resource } = useQuery({ queryKey: ['resource', block.resource_id], queryFn: () => getResource(block.resource_id!), enabled: !!block.resource_id });
  const Icon = TYPE_ICON[block.block_type];
  const { data: previewUrl } = useQuery({ queryKey: ['resource-access-url', block.resource_id], queryFn: () => getResourceAccessUrl(block.resource_id!), enabled: !!block.resource_id });
  const hasImage = resource?.file_type === 'image';
  const hasVideo = resource?.file_type === 'video';
  const hasYoutube = resource?.file_type === 'youtube' && resource.thumbnail_url;
  return (
    <button onClick={(e) => { if (connectMode) return; e.stopPropagation(); onOpen(); }} className="w-full h-full relative group overflow-hidden text-left">
      {hasImage ? <img src={previewUrl || ''} alt={resource!.name} className="w-full h-full object-cover" /> : hasVideo ? <video src={previewUrl || ''} className="w-full h-full object-cover" preload="metadata" muted /> : hasYoutube ? <img src={resource!.thumbnail_url} alt={resource!.name} className="w-full h-full object-cover" /> : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-text-secondary bg-gradient-to-br from-surface-raised to-bg/40">
          {Icon && <Icon size={30} strokeWidth={1.4} />}
          <span className="text-[10px] font-mono uppercase tracking-wider">{TYPE_LABEL[block.block_type]}</span>
        </div>
      )}
      {!connectMode && <div className="absolute inset-0 flex items-center justify-center bg-bg/0 group-hover:bg-bg/55 transition-colors opacity-0 group-hover:opacity-100"><span className="text-[11px] text-text-primary bg-surface/95 border border-border px-2 py-1 rounded-sm">Open resource</span></div>}
    </button>
  );
}

export default function ProjectCanvas({ projectId }: ProjectCanvasProps) {
  const queryClient = useQueryClient();
  const viewportRef = useRef<HTMLDivElement>(null);
  const { data: canvas, isLoading, error } = useQuery<CanvasData>({ queryKey: ['canvas', projectId], queryFn: () => getCanvas(projectId) });
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [viewingResourceId, setViewingResourceId] = useState<string | null>(null);
  const [browsingFolderId, setBrowsingFolderId] = useState<string | null>(null);
  const [viewingResource, setViewingResource] = useState<Resource | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [liveGeometry, setLiveGeometry] = useState<Record<string, { x: number; y: number; width: number; height: number }>>({});
  const [textDrafts, setTextDrafts] = useState<Record<string, string>>({});
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.75);
  const [showGrid, setShowGrid] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [canvasSearch, setCanvasSearch] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['canvas', projectId] });
  const mutationError = (err: any, fallback: string) => setCanvasError(typeof err?.message === 'string' ? err.message : fallback);
  const updateBlockMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateBlock>[1] }) => updateBlock(id, patch),
    onSuccess: (_saved, variables) => {
      setLiveGeometry(prev => { const next = { ...prev }; delete next[variables.id]; return next; });
      if ('text_content' in variables.patch) setTextDrafts(prev => { const next = { ...prev }; delete next[variables.id]; return next; });
      invalidate();
    },
    onError: (err: any) => mutationError(err, 'Failed to save canvas change')
  });
  const createBlockMutation = useMutation({ mutationFn: (block: Parameters<typeof createBlock>[1]) => createBlock(projectId, block), onSuccess: () => { invalidate(); setShowAddBlock(false); }, onError: (err: any) => mutationError(err, 'Failed to create block') });
  // F2.2 DELETE HARDENING: optimistic cache removal + rollback on API failure.
  const deleteBlockMutation = useMutation({
    mutationFn: async (blockId: string) => {
      // Pass the owning project so the local-first API can route the delete
      // through the workstation SQLite runtime and queue its sync outbox entry.
      await deleteBlock(blockId, projectId);
      return blockId;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['canvas', projectId] });
      const previousCanvas = queryClient.getQueryData<CanvasData>(['canvas', projectId]);
      queryClient.setQueryData<CanvasData | undefined>(['canvas', projectId], (current) => {
        if (!current) return current;
        return {
          ...current,
          blocks: current.blocks.filter((block) => block.id !== id),
          connectors: current.connectors.filter(
            (connector) => connector.source_block_id !== id && connector.target_block_id !== id
          ),
        };
      });
      setSelectedBlockId((selected) => selected === id ? null : selected);
      setConnectSource((source) => source === id ? null : source);
      setLiveGeometry(prev => { const next = { ...prev }; delete next[id]; return next; });
      setTextDrafts(prev => { const next = { ...prev }; delete next[id]; return next; });
      return { previousCanvas };
    },
    onError: (err: any, _id, context) => {
      if (context?.previousCanvas) queryClient.setQueryData(['canvas', projectId], context.previousCanvas);
      mutationError(err, 'Failed to delete block');
    },
    onSuccess: () => setCanvasError(null),
    onSettled: () => invalidate(),
  });
  const createConnectorMutation = useMutation({ mutationFn: (payload: { source_block_id: string; target_block_id: string }) => createConnector(projectId, payload), onSuccess: invalidate, onError: (err: any) => mutationError(err, 'Failed to create connector') });
  const deleteConnectorMutation = useMutation({ mutationFn: (connectorId: string) => deleteConnector(connectorId, projectId), onSuccess: invalidate, onError: (err: any) => mutationError(err, 'Failed to remove connector') });

  useEffect(() => { if (!viewingResourceId) { setViewingResource(null); return; } getResource(viewingResourceId).then(setViewingResource).catch(() => setViewingResource(null)); }, [viewingResourceId]);

  const geometryFor = useCallback((block: CanvasBlock) => liveGeometry[block.id] ?? block, [liveGeometry]);
  const blockById = useCallback((id: string) => canvas?.blocks.find((b) => b.id === id), [canvas]);
  const selectedBlock = canvas?.blocks.find((b) => b.id === selectedBlockId) ?? null;
  const canEdit = canvas?.permissions?.can_edit !== false;
  const filteredBlocks = useMemo(() => {
    const q = canvasSearch.trim().toLowerCase();
    if (!canvas?.blocks || !q) return canvas?.blocks || [];
    return canvas.blocks.filter(b => `${b.title || ''} ${b.text_content || ''} ${TYPE_LABEL[b.block_type] || b.block_type}`.toLowerCase().includes(q));
  }, [canvas, canvasSearch]);

  const fitToContent = useCallback(() => {
    if (!canvas?.blocks.length) { setZoom(0.75); return; }
    const maxX = Math.max(...canvas.blocks.map(b => b.x + b.width), 800);
    const maxY = Math.max(...canvas.blocks.map(b => b.y + b.height), 500);
    const viewport = viewportRef.current;
    if (!viewport) { setZoom(0.75); return; }
    const availableW = Math.max(viewport.clientWidth - (showInspector ? 300 : 20), 420);
    const availableH = Math.max(viewport.clientHeight - 70, 320);
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(availableW / maxX, availableH / maxY) * 0.9)));
    requestAnimationFrame(() => viewport.scrollTo({ left: 0, top: 0, behavior: 'smooth' }));
  }, [canvas, showInspector]);

  const requestDeleteBlock = useCallback((blockId: string) => {
    if (!canEdit || deleteBlockMutation.isPending) return;
    const block = canvas?.blocks.find((item) => item.id === blockId);
    if (!block) return;
    const label = block.title || TYPE_LABEL[block.block_type] || 'this block';
    if (!window.confirm(`Delete \"${label}\" from the canvas?`)) return;
    setCanvasError(null);
    deleteBlockMutation.mutate(blockId);
  }, [canEdit, canvas?.blocks, deleteBlockMutation]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); fitToContent(); }
      if (e.key === 'Escape') { setConnectMode(false); setConnectSource(null); setSelectedBlockId(null); }
      if (canEdit && (e.key === 'Delete' || e.key === 'Backspace') && selectedBlockId) { e.preventDefault(); requestDeleteBlock(selectedBlockId); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [canEdit, fitToContent, selectedBlockId, requestDeleteBlock]);

  const handleDragStart = useCallback((block: CanvasBlock, e: React.MouseEvent) => {
    if (connectMode || !canEdit) return; e.preventDefault(); setSelectedBlockId(block.id);
    const startMouseX = e.clientX, startMouseY = e.clientY, start = geometryFor(block);
    const onMove = (m: MouseEvent) => setLiveGeometry(prev => ({ ...prev, [block.id]: { ...start, x: Math.max(0, start.x + (m.clientX - startMouseX) / zoom), y: Math.max(0, start.y + (m.clientY - startMouseY) / zoom) } }));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); setLiveGeometry(prev => { const final = prev[block.id]; if (final) updateBlockMutation.mutate({ id: block.id, patch: { x: final.x, y: final.y } }); return prev; }); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  }, [connectMode, canEdit, geometryFor, updateBlockMutation, zoom]);

  const handleResizeStart = useCallback((block: CanvasBlock, e: React.MouseEvent) => {
    if (!canEdit) return; e.preventDefault(); e.stopPropagation(); setSelectedBlockId(block.id); const start = geometryFor(block), sx=e.clientX, sy=e.clientY;
    const onMove=(m:MouseEvent)=>setLiveGeometry(prev=>({...prev,[block.id]:{...start,width:Math.max(MIN_WIDTH,start.width+(m.clientX-sx)/zoom),height:Math.max(MIN_HEIGHT,start.height+(m.clientY-sy)/zoom)}}));
    const onUp=()=>{window.removeEventListener('mousemove',onMove);window.removeEventListener('mouseup',onUp);setLiveGeometry(prev=>{const final=prev[block.id];if(final)updateBlockMutation.mutate({id:block.id,patch:{width:final.width,height:final.height}});return prev;});};
    window.addEventListener('mousemove',onMove); window.addEventListener('mouseup',onUp);
  }, [canEdit, geometryFor, updateBlockMutation, zoom]);

  const handleBlockClick = (blockId: string) => {
    if (!connectMode) { setSelectedBlockId(blockId); return; }
    if (!connectSource) setConnectSource(blockId); else if (connectSource !== blockId) { createConnectorMutation.mutate({ source_block_id: connectSource, target_block_id: blockId }); setConnectSource(null); }
  };
  const textValueFor=(b:CanvasBlock)=>textDrafts[b.id] ?? b.text_content ?? '';
  const saveText=(b:CanvasBlock)=>{const d=textDrafts[b.id];if(d!==undefined&&d!==b.text_content)updateBlockMutation.mutate({id:b.id,patch:{text_content:d}})};
  const startTitle=(b:CanvasBlock)=>{setEditingTitleId(b.id);setTitleDraft(b.title??'')};
  const saveTitle=(b:CanvasBlock)=>{const v=titleDraft.trim();if(v!==(b.title??''))updateBlockMutation.mutate({id:b.id,patch:{title:v||null}});setEditingTitleId(null)};
  const handleCreateBlock=(payload:{block_type:CanvasBlock['block_type'];title?:string;text_content?:string;resource_id?:string})=>{const count=canvas?.blocks.length??0;createBlockMutation.mutate({...payload,x:80+(count%4)*40,y:80+(count%4)*40,width:DEFAULT_WIDTH,height:DEFAULT_HEIGHT})};

  if(isLoading)return <div className="p-6 text-text-secondary">Loading canvas…</div>;
  if(error)return <div className="p-6 text-status-danger">Error loading canvas</div>;
  if(!canvas)return null;

  return <div className="canvas-shell flex flex-col h-full min-h-0">
    <div className="canvas-toolbar flex items-center justify-between gap-2 px-3 py-2 flex-shrink-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="canvas-status text-accent hidden sm:block">PROJECT CANVAS</span>
        <div className="h-4 w-px bg-border hidden sm:block" />
        <div className="relative hidden md:block"><Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary"/><input value={canvasSearch} onChange={e=>setCanvasSearch(e.target.value)} placeholder="Find a block…" className="w-44 pl-7 pr-2 py-1.5 bg-bg border border-border rounded-sm text-xs focus:outline-none focus:border-accent"/></div>
      </div>
      <div className="flex items-center gap-1">
        <button className={`canvas-tool p-2 rounded-sm ${showGrid?'active text-accent':'text-text-secondary'}`} onClick={()=>setShowGrid(v=>!v)} title="Toggle grid"><Grid size={15}/></button>
        <button className="canvas-tool p-2 rounded-sm text-text-secondary" onClick={()=>setZoom(z=>Math.min(ZOOM_MAX,z+0.1))} title="Zoom in"><ZoomIn size={15}/></button>
        <button className="canvas-tool p-2 rounded-sm text-text-secondary" onClick={()=>setZoom(z=>Math.max(ZOOM_MIN,z-0.1))} title="Zoom out"><ZoomOut size={15}/></button>
        <button className="canvas-tool px-2 rounded-sm text-text-secondary font-mono text-[10px]" onClick={fitToContent} title="Fit canvas (Ctrl+0)">{Math.round(zoom*100)}%</button>
        <button className="canvas-tool p-2 rounded-sm text-text-secondary" onClick={fitToContent} title="Fit to content"><Maximize2 size={15}/></button>
        <button className={`canvas-tool p-2 rounded-sm ${showInspector?'active text-accent':'text-text-secondary'}`} onClick={()=>setShowInspector(v=>!v)} title="Toggle inspector"><PanelRight size={15}/></button>
        <button disabled={!canEdit} onClick={()=>{setConnectMode(v=>!v);setConnectSource(null)}} className={`ml-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-xs border ${connectMode?'bg-accent/10 border-accent text-accent':'bg-surface-raised border-border text-text-secondary hover:text-text-primary'}`}><Cable size={14}/>{connectMode?(connectSource?'Pick target':'Pick source'):'Connect'}</button>
        <button disabled={!canEdit} onClick={()=>setShowAddBlock(true)} className="ml-1 flex items-center gap-1.5 px-2.5 py-1.5 bg-accent text-bg rounded-sm hover:bg-accent-dim text-xs font-medium"><Plus size={14}/>Add block</button>
      </div>
    </div>

    {canvasError&&<div className="mx-3 mt-2 flex items-center justify-between gap-3 px-3 py-2 bg-status-danger/10 border border-status-danger/30 rounded-sm text-xs text-status-danger"><span>{canvasError}</span><button onClick={()=>setCanvasError(null)}><X size={14}/></button></div>}

    {!canEdit&&<div className="mx-3 mt-2 px-3 py-2 bg-surface-raised border border-border rounded-sm text-xs text-text-secondary">This project is read-only for your current project role.</div>}

    <div className="flex-1 min-h-0 flex overflow-hidden">
      <div ref={viewportRef} className={`canvas-viewport flex-1 overflow-auto relative ${showGrid?'':'[background-image:none]'}`}>
        <div className="relative" style={{width:CANVAS_SIZE.width*zoom,height:CANVAS_SIZE.height*zoom}}>
          <div className="canvas-stage" style={{width:CANVAS_SIZE.width,height:CANVAS_SIZE.height,transform:`scale(${zoom})`}}>
            <svg className="absolute inset-0 pointer-events-none" width={CANVAS_SIZE.width} height={CANVAS_SIZE.height}>
              <defs><marker id={`arrow-${projectId}`} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="var(--color-accent)"/></marker></defs>
              {canvas.connectors.map(conn=>{const s=blockById(conn.source_block_id),t=blockById(conn.target_block_id);if(!s||!t)return null;const sg=geometryFor(s),tg=geometryFor(t);const x1=sg.x+sg.width/2,y1=sg.y+sg.height/2,x2=tg.x+tg.width/2,y2=tg.y+tg.height/2;const dx=Math.max(50,Math.abs(x2-x1)*.35);return <g key={conn.id} className="pointer-events-auto"><path d={`M ${x1} ${y1} C ${x1+dx} ${y1}, ${x2-dx} ${y2}, ${x2} ${y2}`} fill="none" stroke="var(--color-accent)" strokeWidth="2" opacity=".65" markerEnd={`url(#arrow-${projectId})`}/><circle cx={(x1+x2)/2} cy={(y1+y2)/2} r="7" fill="var(--color-surface)" stroke="var(--color-border)" className="cursor-pointer" onClick={()=>{if(canEdit)deleteConnectorMutation.mutate(conn.id)}}/></g>})}
            </svg>
            {canvas.blocks.map(block=>{const geo=geometryFor(block),Icon=TYPE_ICON[block.block_type],selected=selectedBlockId===block.id,visible=filteredBlocks.some(b=>b.id===block.id),source=connectSource===block.id;return <div key={block.id} style={{left:geo.x,top:geo.y,width:geo.width,height:geo.height,opacity:visible?1:.18}} className={`canvas-block absolute bg-surface-raised border rounded-md flex flex-col overflow-hidden ${selected||source?'selected':''} ${connectMode?'cursor-pointer':''}`} onClick={()=>handleBlockClick(block.id)}>
              <div onMouseDown={e=>handleDragStart(block,e)} className="flex items-center justify-between gap-2 px-2.5 py-2 border-b border-border bg-surface cursor-move flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0 flex-1"><span className="w-6 h-6 rounded-sm bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">{Icon&&<Icon size={13}/>}</span>{editingTitleId===block.id?<input autoFocus value={titleDraft} onChange={e=>setTitleDraft(e.target.value)} onMouseDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape')setEditingTitleId(null)}} onBlur={()=>saveTitle(block)} placeholder="Block title…" className="min-w-0 flex-1 bg-transparent text-xs focus:outline-none border-b border-accent"/>:<button onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();if(canEdit&&!connectMode)startTitle(block)}} className="min-w-0 flex-1 text-left truncate"><span className={block.title?'text-text-primary font-medium':'text-text-secondary uppercase font-mono'}>{block.title||TYPE_LABEL[block.block_type]}</span></button>}</div><button onClick={e=>{e.stopPropagation();requestDeleteBlock(block.id)}} className="p-1 text-text-secondary hover:text-status-danger"><X size={13}/></button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{block.block_type==='text'?<><textarea value={textValueFor(block)} onChange={e=>setTextDrafts(p=>({...p,[block.id]:e.target.value}))} onBlur={()=>saveText(block)} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();saveText(block)}}} onMouseDown={e=>{if(!connectMode)e.stopPropagation()}} onClick={e=>{if(!connectMode)e.stopPropagation()}} readOnly={connectMode||!canEdit} placeholder="Write a project note…" className="w-full flex-1 min-h-0 text-text-primary text-sm whitespace-pre-wrap break-words p-3 bg-transparent resize-none focus:outline-none"/><div className="flex items-center justify-end px-2 py-1 border-t border-border bg-surface"><button disabled={!canEdit||connectMode||textDrafts[block.id]===undefined||textDrafts[block.id]===block.text_content||updateBlockMutation.isPending} onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();saveText(block)}} className="px-2 py-1 text-[10px] rounded-sm text-accent hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed">{updateBlockMutation.isPending?'Saving…':'Save'}</button></div></>:<BlockContent block={block} connectMode={connectMode} onOpen={()=>{if(!block.resource_id)return;if(block.block_type==='folder')setBrowsingFolderId(block.resource_id);else setViewingResourceId(block.resource_id)}}/>}</div>
              <div onMouseDown={e=>handleResizeStart(block,e)} className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize" style={{background:'linear-gradient(135deg, transparent 50%, var(--color-border) 50%)'}}/>
            </div>})}
          </div>
        </div>
        {canvas.blocks.length===0&&<div className="absolute inset-0 flex items-center justify-center"><div className="text-center max-w-sm"><div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-accent/10 text-accent flex items-center justify-center"><Crosshair size={26}/></div><h3 className="text-lg font-semibold">Build the project map</h3><p className="text-sm text-text-secondary mt-2 mb-5">Connect notes, documents, media and project knowledge on one visual engineering board.</p><button disabled={!canEdit} onClick={()=>setShowAddBlock(true)} className="px-4 py-2 bg-accent text-bg rounded-sm text-sm font-medium">Add first block</button></div></div>}
        <div className="canvas-minimap absolute bottom-3 right-3 w-44 h-28 rounded-md p-2 hidden md:block pointer-events-none"><div className="relative w-full h-full bg-bg/60 overflow-hidden">{canvas.blocks.map(b=><div key={b.id} className="canvas-mini-block" style={{left:`${b.x/CANVAS_SIZE.width*100}%`,top:`${b.y/CANVAS_SIZE.height*100}%`,width:`${Math.max(2,b.width/CANVAS_SIZE.width*100)}%`,height:`${Math.max(2,b.height/CANVAS_SIZE.height*100)}%`}}/>)}<div className="absolute inset-0 border border-accent/40"/></div></div>
      </div>

      {showInspector&&<aside className="canvas-inspector flex-shrink-0 overflow-y-auto hidden md:block"><div className="p-4 border-b border-border"><div className="flex items-center justify-between"><div><div className="page-kicker">INSPECTOR</div><h3 className="text-sm font-semibold mt-1">Canvas properties</h3></div><button onClick={()=>setShowInspector(false)} className="p-1 text-text-secondary hover:text-text-primary"><X size={15}/></button></div></div>{selectedBlock?<div className="p-4 space-y-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-md bg-accent/10 text-accent flex items-center justify-center">{(()=>{const I=TYPE_ICON[selectedBlock.block_type];return I?<I size={19}/>:null})()}</div><div className="min-w-0"><div className="font-medium truncate">{selectedBlock.title||TYPE_LABEL[selectedBlock.block_type]}</div><div className="text-[10px] text-text-secondary uppercase tracking-wider">{TYPE_LABEL[selectedBlock.block_type]}</div></div></div><div className="grid grid-cols-2 gap-2">{(['x','y','width','height'] as const).map(k=><div key={k} className="bg-bg border border-border rounded-sm p-2"><div className="text-[10px] text-text-secondary uppercase">{k}</div><div className="font-mono text-xs mt-1">{Math.round(geometryFor(selectedBlock)[k])}</div></div>)}</div><div className="border-t border-border pt-4"><div className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">Actions</div><div className="space-y-1"><button disabled={!canEdit} onClick={()=>startTitle(selectedBlock)} className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-raised rounded-sm"><MousePointer2 size={14}/>Rename block</button><button disabled={!canEdit} onClick={()=>{if(!canEdit)return;setLiveGeometry(p=>({...p,[selectedBlock.id]:{...selectedBlock,x:80,y:80}}));updateBlockMutation.mutate({id:selectedBlock.id,patch:{x:80,y:80}})}} className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-raised rounded-sm"><RotateCcw size={14}/>Reset position</button><button disabled={!canEdit} onClick={()=>{requestDeleteBlock(selectedBlock.id)}} className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-status-danger hover:bg-status-danger/10 rounded-sm"><Trash2 size={14}/>Delete block</button></div></div>{selectedBlock.resource_id&&<div className="border-t border-border pt-4"><div className="text-[10px] text-text-secondary uppercase tracking-wider">Resource</div><div className="text-xs mt-1 break-all text-text-primary">{selectedBlock.resource_id}</div></div>}</div>:<div className="p-5 text-center text-text-secondary"><MousePointer2 size={22} className="mx-auto mb-3 opacity-60"/><p className="text-xs">Select a block to inspect it.</p><p className="text-[10px] mt-2">Drag to move · corner handle to resize · Delete to remove</p></div>}</aside>}
    </div>

    {showAddBlock&&<AddBlockModal projectId={projectId} onClose={()=>setShowAddBlock(false)} onCreate={handleCreateBlock}/>} {viewingResource&&<ResourceViewerModal resource={viewingResource} onClose={()=>setViewingResourceId(null)}/>} {browsingFolderId&&<FolderBrowserModal folderResourceId={browsingFolderId} onClose={()=>setBrowsingFolderId(null)}/>} 
  </div>;
}
