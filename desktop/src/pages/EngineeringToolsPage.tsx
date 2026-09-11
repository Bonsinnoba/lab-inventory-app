import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Calculator, Ruler, Zap, Minus, X, Save, Trash2, GitCompare, LineChart, ClipboardCheck } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { calculateEngineering, compareCalculations, createEngineeringTest, deleteCalculation, deleteEngineeringTest, getCalculations, getEngineeringTests, saveCalculation } from '../api/engineering';
import { useToast } from '../contexts/ToastContext';

const input='w-full px-2.5 py-2 bg-bg border border-border rounded-sm text-sm focus:outline-none focus:border-accent';
type Tool='calculator'|'formula'|'electronics'|'graphing'|'tests'|'saved'|'compare';
const tools:[Tool,string,any][]=[['calculator','Calculator',Calculator],['formula','Formula',Ruler],['electronics','Electronics',Zap],['graphing','Graphing',LineChart],['tests','Engineering Tests',ClipboardCheck],['saved','Saved Calculations',Save],['compare','Compare Results',GitCompare]];

interface WindowProps {
  children: ReactNode;
  onClose: () => void;
  minimized: boolean;
  setMinimized: (value: boolean) => void;
}

type Point = { x: number; y: number };
type WindowSize = { width: number; height: number };
type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const WINDOW_MARGIN = 16;
const WINDOW_TOP_MIN = 48;
const MIN_WINDOW_WIDTH = 480;
const MIN_WINDOW_HEIGHT = 340;
const DEFAULT_WINDOW_SIZE: WindowSize = { width: 760, height: 560 };
const MINIMIZED_WIDTH = 200;
const MINIMIZED_HEIGHT = 44;

function clampPosition(point: Point, width: number, height: number): Point {
  const maxX = Math.max(WINDOW_MARGIN, window.innerWidth - width - WINDOW_MARGIN);
  const maxY = Math.max(WINDOW_TOP_MIN, window.innerHeight - height - WINDOW_MARGIN);
  return {
    x: Math.min(Math.max(WINDOW_MARGIN, point.x), maxX),
    y: Math.min(Math.max(WINDOW_TOP_MIN, point.y), maxY),
  };
}

function clampSize(width: number, height: number): WindowSize {
  const maxWidth = Math.max(MIN_WINDOW_WIDTH, window.innerWidth - WINDOW_MARGIN * 2);
  const maxHeight = Math.max(MIN_WINDOW_HEIGHT, window.innerHeight - WINDOW_TOP_MIN - WINDOW_MARGIN);
  return {
    width: Math.min(Math.max(MIN_WINDOW_WIDTH, width), maxWidth),
    height: Math.min(Math.max(MIN_WINDOW_HEIGHT, height), maxHeight),
  };
}

function clampMiniPosition(point: Point): Point {
  const maxX = Math.max(WINDOW_MARGIN, window.innerWidth - MINIMIZED_WIDTH - WINDOW_MARGIN);
  const maxY = Math.max(WINDOW_MARGIN, window.innerHeight - MINIMIZED_HEIGHT - WINDOW_MARGIN);
  return {
    x: Math.min(Math.max(WINDOW_MARGIN, point.x), maxX),
    y: Math.min(Math.max(WINDOW_MARGIN, point.y), maxY),
  };
}

function Window({ children, onClose, minimized, setMinimized }: WindowProps) {
  const [size, setSize] = useState<WindowSize>(() => clampSize(DEFAULT_WINDOW_SIZE.width, DEFAULT_WINDOW_SIZE.height));
  const [pos, setPos] = useState<Point>(() => clampPosition({
    x: Math.round((window.innerWidth - DEFAULT_WINDOW_SIZE.width) / 2),
    y: Math.max(WINDOW_TOP_MIN, Math.round((window.innerHeight - DEFAULT_WINDOW_SIZE.height) / 2)),
  }, DEFAULT_WINDOW_SIZE.width, DEFAULT_WINDOW_SIZE.height));
  const [miniPos, setMiniPos] = useState<Point>(() => clampMiniPosition({
    x: window.innerWidth - MINIMIZED_WIDTH - WINDOW_MARGIN,
    y: window.innerHeight - MINIMIZED_HEIGHT - WINDOW_MARGIN,
  }));

  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; left: number; top: number } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    direction: ResizeDirection;
    startX: number;
    startY: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const miniDragRef = useRef<{ pointerId: number; startX: number; startY: number; left: number; top: number; moved: boolean } | null>(null);

  useEffect(() => {
    const handleResize = () => {
      setSize(previous => {
        const next = clampSize(previous.width, previous.height);
        setPos(previousPos => clampPosition(previousPos, next.width, next.height));
        return next;
      });
      setMiniPos(previous => clampMiniPosition(previous));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: pos.x,
      top: pos.y,
    };
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPos(clampPosition({
      x: drag.left + event.clientX - drag.startX,
      y: drag.top + event.clientY - drag.startY,
    }, size.width, size.height));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const beginResize = (direction: ResizeDirection) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      left: pos.x,
      top: pos.y,
      width: size.width,
      height: size.height,
    };
  };

  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;

    const dx = event.clientX - resize.startX;
    const dy = event.clientY - resize.startY;
    let width = resize.width;
    let height = resize.height;
    let left = resize.left;
    let top = resize.top;

    if (resize.direction.includes('e')) width = resize.width + dx;
    if (resize.direction.includes('s')) height = resize.height + dy;
    if (resize.direction.includes('w')) {
      width = resize.width - dx;
      left = resize.left + dx;
    }
    if (resize.direction.includes('n')) {
      height = resize.height - dy;
      top = resize.top + dy;
    }

    const nextSize = clampSize(width, height);
    if (resize.direction.includes('w')) left = resize.left + (resize.width - nextSize.width);
    if (resize.direction.includes('n')) top = resize.top + (resize.height - nextSize.height);

    setSize(nextSize);
    setPos(clampPosition({ x: left, y: top }, nextSize.width, nextSize.height));
  };

  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const beginMiniDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    miniDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: miniPos.x,
      top: miniPos.y,
      moved: false,
    };
  };

  const moveMiniDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = miniDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    setMiniPos(clampMiniPosition({ x: drag.left + dx, y: drag.top + dy }));
  };

  const endMiniDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const restoreFromMini = () => {
    const moved = miniDragRef.current?.moved ?? false;
    miniDragRef.current = null;
    if (!moved) setMinimized(false);
  };

  if (minimized) {
    return (
      <button
        type="button"
        onPointerDown={beginMiniDrag}
        onPointerMove={moveMiniDrag}
        onPointerUp={endMiniDrag}
        onPointerCancel={endMiniDrag}
        onClick={restoreFromMini}
        style={{ left: miniPos.x, top: miniPos.y, width: MINIMIZED_WIDTH, height: MINIMIZED_HEIGHT }}
        className="fixed z-[80] px-4 bg-surface border border-accent rounded-sm shadow-lg text-sm flex items-center justify-center gap-2 cursor-move select-none touch-none"
        aria-label="Restore Engineering Tools"
        title="Drag to move, click to restore"
      >
        <Calculator size={16} /> Engineering Tools
      </button>
    );
  }

  const handles: Array<[ResizeDirection, string]> = [
    ['n', 'top-0 left-3 right-3 h-2 cursor-n-resize'],
    ['s', 'bottom-0 left-3 right-3 h-2 cursor-s-resize'],
    ['e', 'right-0 top-3 bottom-3 w-2 cursor-e-resize'],
    ['w', 'left-0 top-3 bottom-3 w-2 cursor-w-resize'],
    ['ne', 'right-0 top-0 w-3 h-3 cursor-ne-resize'],
    ['nw', 'left-0 top-0 w-3 h-3 cursor-nw-resize'],
    ['se', 'right-0 bottom-0 w-3 h-3 cursor-se-resize'],
    ['sw', 'left-0 bottom-0 w-3 h-3 cursor-sw-resize'],
  ];

  return (
    <div
      style={{ left: pos.x, top: pos.y, width: size.width, height: size.height }}
      className="fixed z-[70] max-w-[calc(100vw-32px)] max-h-[calc(100vh-64px)] bg-surface border border-border rounded-md shadow-2xl overflow-hidden"
      role="dialog"
      aria-label="Engineering Tools"
    >
      <div
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="h-11 px-4 bg-surface-raised border-b border-border flex items-center justify-between cursor-move select-none touch-none"
      >
        <div className="font-semibold text-sm flex items-center gap-2"><Calculator size={17} /> Engineering Tools</div>
        <div className="flex gap-1">
          <button type="button" onPointerDown={event => event.stopPropagation()} onClick={() => setMinimized(true)} title="Minimize" className="p-1.5 hover:bg-bg rounded"><Minus size={15} /></button>
          <button type="button" onPointerDown={event => event.stopPropagation()} onClick={onClose} title="Close" className="p-1.5 hover:bg-bg rounded"><X size={15} /></button>
        </div>
      </div>
      <div className="h-[calc(100%-44px)] overflow-hidden">{children}</div>
      {handles.map(([direction, className]) => (
        <div
          key={direction}
          onPointerDown={beginResize(direction)}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          className={`absolute z-10 ${className}`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function Field({label,value,onChange,type='number'}:{label:string;value:string;onChange:(v:string)=>void;type?:string}){return <label className="text-xs text-text-secondary">{label}<input type={type} step="any" value={value} onChange={e=>onChange(e.target.value)} className={`${input} mt-1`}/></label>}

function Electronics({onResult}:{onResult:(r:any)=>void}){
  const [mode,setMode]=useState<'ohm'|'power'|'divider'|'led'>('ohm');
  const [v,setV]=useState<Record<string,string>>({});
  const run=async()=>{
    const maps:any={ohm:['ohms_law',{current_A:Number(v.i),resistance_ohm:Number(v.r)}],power:['power_vi',{voltage_V:Number(v.v),current_A:Number(v.i)}],divider:['voltage_divider',{vin_V:Number(v.v),r1_ohm:Number(v.r1),r2_ohm:Number(v.r2)}],led:['led_resistor',{supply_V:Number(v.vs),forward_V:Number(v.vf),current_A:Number(v.i)}]};
    const [formula,inputs]=maps[mode] as [string,Record<string,number>];
    onResult(await calculateEngineering(formula,inputs));
  };
  return <div><select className={input} value={mode} onChange={e=>{setMode(e.target.value as any);setV({})}}><option value="ohm">Ohm's Law</option><option value="power">Power</option><option value="divider">Voltage Divider</option><option value="led">LED Resistor</option></select><div className="grid sm:grid-cols-3 gap-3 mt-3">{mode==='ohm'&&<><Field label="Current (A)" value={v.i||''} onChange={x=>setV({...v,i:x})}/><Field label="Resistance (ohm)" value={v.r||''} onChange={x=>setV({...v,r:x})}/></>}{mode==='power'&&<><Field label="Voltage (V)" value={v.v||''} onChange={x=>setV({...v,v:x})}/><Field label="Current (A)" value={v.i||''} onChange={x=>setV({...v,i:x})}/></>}{mode==='divider'&&<><Field label="Vin (V)" value={v.v||''} onChange={x=>setV({...v,v:x})}/><Field label="R1 (ohm)" value={v.r1||''} onChange={x=>setV({...v,r1:x})}/><Field label="R2 (ohm)" value={v.r2||''} onChange={x=>setV({...v,r2:x})}/></>}{mode==='led'&&<><Field label="Supply (V)" value={v.vs||''} onChange={x=>setV({...v,vs:x})}/><Field label="Forward (V)" value={v.vf||''} onChange={x=>setV({...v,vf:x})}/><Field label="Current (A)" value={v.i||''} onChange={x=>setV({...v,i:x})}/></>}</div><button onClick={run} className="mt-4 px-3 py-2 bg-accent text-bg rounded-sm text-sm">Calculate</button></div>;
}

interface EngineeringToolsProps {open:boolean;minimized:boolean;onClose:()=>void;onMinimize:()=>void;}

export default function EngineeringToolsPage({open,minimized,onClose,onMinimize}:EngineeringToolsProps){
  const [tool,setTool]=useState<Tool>('calculator');
  const [last,setLast]=useState<any>(null);
  const [title,setTitle]=useState('');
  const [projectId,setProjectId]=useState('');
  const [graph,setGraph]=useState('10,20\n20,35\n30,28\n40,50');
  const [test,setTest]=useState({title:'',description:'',status:'planned',conclusion:''});
  const qc=useQueryClient();
  const {showToast}=useToast();
  const calcs=useQuery({queryKey:['engineering-calculations'],queryFn:getCalculations,enabled:open});
  const tests=useQuery({queryKey:['engineering-tests'],queryFn:getEngineeringTests,enabled:open});
  const save=useMutation({mutationFn:()=>saveCalculation({title:title||'Engineering calculation',project_id:projectId||null,category:'engineering',formula:last.formula,inputs:last.inputs,result_numeric:last.result_numeric,result_unit:last.result_unit}),onSuccess:()=>{qc.invalidateQueries({queryKey:['engineering-calculations']});showToast('Calculation saved')}});
  const addTest=useMutation({mutationFn:()=>createEngineeringTest({...test,project_id:projectId||null}),onSuccess:()=>{setTest({title:'',description:'',status:'planned',conclusion:''});qc.invalidateQueries({queryKey:['engineering-tests']});showToast('Engineering test saved')}});
  const delCalc=useMutation({mutationFn:deleteCalculation,onSuccess:()=>qc.invalidateQueries({queryKey:['engineering-calculations']})});
  const delTest=useMutation({mutationFn:deleteEngineeringTest,onSuccess:()=>qc.invalidateQueries({queryKey:['engineering-tests']})});
  const compare=async()=>{const ids=(calcs.data||[]).slice(0,5).map((c:any)=>c.id);if(ids.length<2)return showToast('Save at least two calculations first','error');const rows=await compareCalculations(ids);showToast(rows.map((r:any)=>`${r.title}: ${r.result_numeric??r.result_text} ${r.result_unit}`).join(' | '));};
  const points=useMemo(()=>graph.split(/\r?\n/).map(x=>x.split(',').map(Number)).filter(a=>a.length===2&&a.every(Number.isFinite)),[graph]);
  const maxX=Math.max(1,...points.map(p=>p[0])),maxY=Math.max(1,...points.map(p=>p[1]));
  const body=tool==='electronics'?<Electronics onResult={setLast}/>:tool==='calculator'?<Electronics onResult={setLast}/>:tool==='formula'?<div className="space-y-2 text-sm"><div className="font-medium">Formula Catalog</div><div className="p-3 bg-surface-raised border border-border rounded-sm">V = I × R</div><div className="p-3 bg-surface-raised border border-border rounded-sm">P = V × I</div><div className="p-3 bg-surface-raised border border-border rounded-sm">Vout = Vin × R2 / (R1 + R2)</div><div className="p-3 bg-surface-raised border border-border rounded-sm">R = (Vs − Vf) / I</div></div>:tool==='graphing'?<div><textarea className={`${input} min-h-28`} value={graph} onChange={e=>setGraph(e.target.value)} placeholder="x,y per line"/><div className="mt-3 border border-border bg-bg rounded-sm p-2"><svg viewBox="0 0 500 240" className="w-full h-56"><polyline fill="none" stroke="currentColor" strokeWidth="2" points={points.map(p=>`${(p[0]/maxX)*470+15},${225-(p[1]/maxY)*200}`).join(' ')}/>{points.map((p,i)=><circle key={i} cx={(p[0]/maxX)*470+15} cy={225-(p[1]/maxY)*200} r="4" fill="currentColor"/>)}</svg></div></div>:tool==='tests'?<div><div className="grid gap-2"><input className={input} placeholder="Test title" value={test.title} onChange={e=>setTest({...test,title:e.target.value})}/><textarea className={input} placeholder="Description" value={test.description} onChange={e=>setTest({...test,description:e.target.value})}/><select className={input} value={test.status} onChange={e=>setTest({...test,status:e.target.value})}><option>planned</option><option>running</option><option>passed</option><option>failed</option><option>cancelled</option></select><textarea className={input} placeholder="Conclusion" value={test.conclusion} onChange={e=>setTest({...test,conclusion:e.target.value})}/><button disabled={!test.title.trim()} onClick={()=>addTest.mutate()} className="px-3 py-2 bg-accent text-bg rounded-sm text-sm">Save test</button></div><div className="mt-4 space-y-2">{(tests.data||[]).map((t:any)=><div key={t.id} className="p-2 border border-border rounded-sm text-xs flex justify-between"><span><b>{t.title}</b> · {t.status}{t.conclusion?` · ${t.conclusion}`:''}</span><button onClick={()=>delTest.mutate(t.id)} className="text-status-danger">×</button></div>)}</div></div>:tool==='saved'?<div className="space-y-2">{(calcs.data||[]).map((c:any)=><div key={c.id} className="p-3 border border-border rounded-sm text-xs flex justify-between"><span><b>{c.title}</b> · {c.result_numeric??c.result_text} {c.result_unit}<div className="text-text-secondary mt-1">{c.formula}</div></span><button onClick={()=>delCalc.mutate(c.id)}><Trash2 size={14}/></button></div>)}{!calcs.data?.length&&<div className="text-sm text-text-secondary">No saved calculations.</div>}</div>:<div className="space-y-3"><p className="text-sm text-text-secondary">Compare the latest saved calculations.</p><button onClick={compare} className="px-3 py-2 bg-accent text-bg rounded-sm text-sm flex items-center gap-2"><GitCompare size={15}/> Compare latest</button></div>;
  if(!open)return null;
  return <Window onClose={onClose} minimized={minimized} setMinimized={onMinimize}><div className="grid grid-cols-[155px_1fr] max-h-[72vh]"><nav className="p-2 border-r border-border bg-surface-raised space-y-1">{tools.map(([id,label,Icon])=><button key={id} onClick={()=>setTool(id)} className={`w-full flex items-center gap-2 px-2 py-2 rounded text-xs text-left ${tool===id?'bg-accent text-bg':'text-text-secondary hover:bg-bg'}`}><Icon size={14}/>{label}</button>)}</nav><main className="p-4 overflow-auto"><div className="text-sm font-medium mb-3">{tools.find(x=>x[0]===tool)?.[1]}</div>{body}{last&&<section className="mt-4 p-3 bg-surface-raised border border-border rounded-sm"><div className="text-xs text-text-secondary">Result</div><div className="text-2xl font-mono mt-1">{Number(last.result_numeric).toPrecision(8)} {last.result_unit}</div><div className="grid sm:grid-cols-2 gap-2 mt-3"><Field label="Saved title" value={title} onChange={setTitle} type="text"/><Field label="Project ID (optional)" value={projectId} onChange={setProjectId} type="text"/></div><button onClick={()=>save.mutate()} className="mt-3 px-3 py-2 border border-border rounded-sm text-xs flex gap-2 items-center"><Save size={14}/> Save calculation</button></section>}</main></div></Window>;
}
