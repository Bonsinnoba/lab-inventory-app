import React, { useEffect, useMemo, useState, type WheelEvent } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Resource } from '../api/resources';

export default function ResourceViewerModal({ resource, resources = [], onClose }: { resource: Resource; resources?: Resource[]; onClose: () => void }) {
  const list = useMemo(() => resources.length ? resources : [resource], [resources, resource]);
  const [leftId, setLeftId] = useState<string | null>(resource.id);
  const [rightId, setRightId] = useState<string | null>(null);
  const [isSplit, setIsSplit] = useState(false);
  const [pickerFor, setPickerFor] = useState<'left' | 'right' | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [hoveredPane, setHoveredPane] = useState<'left' | 'right'>('left');
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState<'normal' | 'large'>('normal');

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
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)) return;
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      if (!isSplit) setLeftId((id) => id ? stepList(id, dir) : id);
      else if (hoveredPane === 'left') setLeftId((id) => id ? stepList(id, dir) : id);
      else if (rightId) setRightId((id) => id ? stepList(id, dir) : id);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, isSplit, hoveredPane, pickerFor, rightId, list]);

  const filtered = list.filter((r) => (r.name || r.original_filename || '').toLowerCase().includes(pickerQuery.toLowerCase()));
  const left = list.find((r) => r.id === leftId) || resource;
  const right = rightId ? list.find((r) => r.id === rightId) : null;

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div className={`${size === 'large' ? 'w-[95vw] h-[95vh]' : 'w-[94vw] h-[88vh] max-w-[1600px]'} bg-background rounded-xl overflow-hidden flex flex-col`}>
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="font-medium">Resource Viewer</div>
        <div className="flex gap-1">
          <button className="px-2 py-1 rounded border" onClick={() => setIsSplit((v) => !v)}>{isSplit ? 'Single' : 'Compare'}</button>
          <button className="px-2 py-1 rounded border" onClick={() => setSize((v) => v === 'large' ? 'normal' : 'large')}>{size === 'large' ? 'Normal' : 'Large'}</button>
          <button className="p-1" onClick={onClose}><X size={18} /></button>
        </div>
      </div>
      <div className={`flex-1 min-h-0 ${isSplit ? 'grid grid-cols-2' : ''}`}>
        <div className="relative min-w-0 border-r" onMouseEnter={() => setHoveredPane('left')}>
          <button className="absolute top-2 right-2 z-10 px-2 py-1 rounded border bg-background" onClick={() => setPickerFor('left')}>Change</button>
          <div className="h-full flex items-center justify-center p-4 overflow-auto">{left.name || left.original_filename}</div>
        </div>
        {isSplit && <div className="relative min-w-0" onMouseEnter={() => setHoveredPane('right')}>
          <button className="absolute top-2 right-2 z-10 px-2 py-1 rounded border bg-background" onClick={() => setPickerFor('right')}>Change</button>
          <div className="h-full flex items-center justify-center p-4 overflow-auto">{right ? (right.name || right.original_filename) : 'Choose a resource'}</div>
        </div>}
      </div>
      <div className="flex items-center justify-between border-t px-3 py-2">
        <div className="flex gap-1"><button className="p-1" onClick={() => setLeftId((id) => id ? stepList(id, -1) : id)}><ChevronLeft size={18}/></button><button className="p-1" onClick={() => setLeftId((id) => id ? stepList(id, 1) : id)}><ChevronRight size={18}/></button></div>
        <div className="flex gap-1"><button className="px-2 py-1 border rounded" onClick={() => setZoom((z) => Math.max(.5, z-.1))}>−</button><span className="px-2 py-1">{Math.round(zoom*100)}%</span><button className="px-2 py-1 border rounded" onClick={() => setZoom((z) => Math.min(3, z+.1))}>+</button></div>
      </div>
    </div>
    {pickerFor && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onMouseDown={() => setPickerFor(null)}>
      <div className="w-full max-w-xl max-h-[75vh] bg-background rounded-xl border shadow-xl flex flex-col" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3"><div className="font-semibold">Choose resource</div><button onClick={() => setPickerFor(null)}><X size={18}/></button></div>
        <div className="p-3"><input autoFocus value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} placeholder="Search resources" className="w-full rounded border px-3 py-2" /></div>
        <div className="overflow-auto px-3 pb-3 space-y-1">{filtered.map((r) => <button key={r.id} className="w-full text-left rounded border px-3 py-2 hover:bg-muted" onClick={() => { if (pickerFor === 'left') setLeftId(r.id); else setRightId(r.id); setPickerFor(null); setPickerQuery(''); }}>{r.name || r.original_filename}</button>)}</div>
      </div>
    </div>}
  </div>;
}
