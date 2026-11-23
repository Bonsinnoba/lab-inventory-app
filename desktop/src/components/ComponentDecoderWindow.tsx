import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CircuitBoard, Copy, Minus, RotateCcw, X } from 'lucide-react';
import { BAND_COLORS, BAND_TCR, BAND_TOLERANCE, DECODER_SOURCES, decodeComponent, defaultBands, defaultDecoderInput, formatComponentValue, type DecoderFamily, type DecoderInput, type DecoderScheme } from '../lib/componentDecoder';
import { clampDecoderIcon, clampDecoderRect, type DecoderRect } from '../lib/decoderWindow';

type Draft = DecoderInput & { evaluated:boolean };
type Drafts = Record<DecoderFamily,Draft>;
const freshDrafts=():Drafts=>({resistor:{...defaultDecoderInput('resistor'),evaluated:false},capacitor:{...defaultDecoderInput('capacitor'),evaluated:false}});
const schemes: {id:DecoderScheme;label:string}[]=[{id:'bands4',label:'4-band resistor'},{id:'bands5',label:'5-band resistor'},{id:'bands6',label:'6-band · Vishay TCR'},{id:'smd',label:'Numeric SMD / zero ohm'},{id:'rkm',label:'RKM decimal marking'},{id:'eia96',label:'EIA-96 · Yageo'}];
const viewport=()=>({width:window.innerWidth,height:window.innerHeight});
const initialRect=()=>clampDecoderRect({x:window.innerWidth-510,y:90,width:480,height:620},viewport());
function restore(key:string):{drafts:Drafts;rect:DecoderRect;icon:{x:number;y:number}} {
  const defaults={drafts:freshDrafts(),rect:initialRect(),icon:clampDecoderIcon({x:window.innerWidth-78,y:window.innerHeight-100},viewport())};
  try {
    const raw=sessionStorage.getItem(key); if(!raw||raw.length>5000) return defaults;
    const saved=JSON.parse(raw);
    for(const family of ['resistor','capacitor'] as const) {
      const d=saved.drafts?.[family];
      if(d?.family===family&&typeof d.marking==='string'&&d.marking.length<=64&&Array.isArray(d.bands)&&d.bands.length>=4&&d.bands.length<=6&&d.bands.every((b:unknown)=>typeof b==='string'&&b.length<12)&&(family==='capacitor'?d.scheme==='capacitor':schemes.some(s=>s.id===d.scheme))) defaults.drafts[family]={family,scheme:d.scheme,marking:d.marking,bands:d.bands,evaluated:d.evaluated===true};
    }
    if(saved.rect) defaults.rect=clampDecoderRect(saved.rect,viewport());
    if(saved.icon) defaults.icon=clampDecoderIcon(saved.icon,viewport());
  } catch { /* A missing/corrupt scratch draft never blocks opening the utility. */ }
  return defaults;
}
export default function ComponentDecoderWindow({accountId}:{accountId:string}) {
  const key=`labos-component-decoder-v1:${accountId}`;
  const [restored]=useState(()=>restore(key));
  const [drafts,setDrafts]=useState(restored.drafts),[rect,setRect]=useState(restored.rect),[icon,setIcon]=useState(restored.icon);
  const [family,setFamily]=useState<DecoderFamily>('resistor'),[visible,setVisible]=useState(false),[minimized,setMinimized]=useState(false),[copyStatus,setCopyStatus]=useState('');
  const titleRef=useRef<HTMLDivElement>(null),iconRef=useRef<HTMLButtonElement>(null);
  const drag=useRef<{x:number;y:number;rect:DecoderRect;icon:{x:number;y:number};kind:string;moved:boolean}|null>(null);
  const suppressClick=useRef(false);
  const draft=drafts[family];
  const decoded=useMemo(()=>{
    if(!draft.evaluated) return {result:null,error:''};
    try {return {result:decodeComponent(draft),error:''};} catch(e) {return {result:null,error:e instanceof Error?e.message:'Unable to decode this marking.'};}
  },[draft]);
  useEffect(()=>{
    const handler=(event:Event)=>{
      const next=(event as CustomEvent).detail?.family;
      if(next!=='resistor'&&next!=='capacitor') return;
      setFamily(next);setVisible(true);setMinimized(false);setRect(r=>clampDecoderRect(r,viewport()));
    };
    window.addEventListener('labos:component-decoder',handler);
    return()=>window.removeEventListener('labos:component-decoder',handler);
  },[]);
  useEffect(()=>{
    if(!visible) return;
    const id=requestAnimationFrame(()=>{(minimized?iconRef:titleRef).current?.focus();});
    return()=>cancelAnimationFrame(id);
  },[visible,minimized]);
  useEffect(()=>{
    const resize=()=>{setRect(r=>clampDecoderRect(r,viewport()));setIcon(p=>clampDecoderIcon(p,viewport()));};
    window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);
  },[]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>{try{sessionStorage.setItem(key,JSON.stringify({drafts,rect,icon}));}catch{/* Storage disabled/full: in-memory drafts still work. */}},200);
    return()=>window.clearTimeout(timer);
  },[drafts,rect,icon,key]);
  useEffect(()=>{setCopyStatus('');},[draft]);
  const update=(patch:Partial<Draft>)=>setDrafts(old=>({...old,[family]:{...old[family],...patch}}));
  const start=(event:ReactPointerEvent<HTMLElement>,kind:string)=>{
    if(event.button!==0) return;
    if(kind==='move'&&(event.target as HTMLElement).closest('button,select,input,a')) return;
    event.preventDefault();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);
    suppressClick.current=false;drag.current={x:event.clientX,y:event.clientY,rect,icon,kind,moved:false};
  };
  const move=(event:ReactPointerEvent<HTMLElement>)=>{
    const d=drag.current;if(!d) return;
    const dx=event.clientX-d.x,dy=event.clientY-d.y;
    if(Math.abs(dx)+Math.abs(dy)>4)d.moved=true;
    if(d.kind==='icon'){setIcon(clampDecoderIcon({x:d.icon.x+dx,y:d.icon.y+dy},viewport()));return;}
    if(d.kind==='move'){setRect(clampDecoderRect({...d.rect,x:d.rect.x+dx,y:d.rect.y+dy},viewport()));return;}
    const next={...d.rect};
    if(d.kind.includes('e')) next.width+=dx;
    if(d.kind.includes('s')) next.height+=dy;
    if(d.kind.includes('w')){next.width=Math.max(340,d.rect.width-dx);next.x=d.rect.x+d.rect.width-next.width;}
    if(d.kind.includes('n')){next.height=Math.max(300,d.rect.height-dy);next.y=d.rect.y+d.rect.height-next.height;}
    setRect(clampDecoderRect(next,viewport()));
  };
  const end=(event:ReactPointerEvent<HTMLElement>)=>{suppressClick.current=drag.current?.kind==='icon'&&Boolean(drag.current.moved);drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);};
  const pointer={onPointerMove:move,onPointerUp:end,onPointerCancel:end};
  const titleKeys=(event:React.KeyboardEvent<HTMLElement>,isIcon=false)=>{
    if(isIcon&&(event.key==='Enter'||event.key===' '))suppressClick.current=false;
    const delta:Record<string,[number,number]>={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]};
    const change=delta[event.key];if(!change)return;event.preventDefault();
    if(isIcon)setIcon(p=>clampDecoderIcon({x:p.x+change[0],y:p.y+change[1]},viewport()));
    else setRect(r=>clampDecoderRect(event.shiftKey?{...r,width:r.width+change[0],height:r.height+change[1]}:{...r,x:r.x+change[0],y:r.y+change[1]},viewport()));
  };
  if(!visible)return null;
  if(minimized)return <button ref={iconRef} type="button" aria-label={`Restore ${family} decoder`} title={`${family} decoder · drag to move, click to restore`} className="fixed z-[80] flex h-[52px] w-[52px] touch-none items-center justify-center rounded-2xl border border-accent bg-surface text-accent shadow-xl focus-visible:ring-2 focus-visible:ring-accent" style={{left:icon.x,top:icon.y}} onPointerDown={e=>start(e,'icon')} {...pointer} onKeyDown={e=>titleKeys(e,true)} onClick={()=>{if(suppressClick.current){suppressClick.current=false;return;}setMinimized(false);}}><CircuitBoard size={25}/></button>;
  const result=decoded.result, count=draft.scheme.startsWith('bands')?Number(draft.scheme.slice(-1)):0, digits=count===4?2:3;
  const control='w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50';
  return <section role="dialog" aria-modal="false" aria-labelledby="component-decoder-title" className="fixed z-[80] flex flex-col rounded-2xl border border-border bg-surface text-text-primary shadow-2xl" style={{left:rect.x,top:rect.y,width:rect.width,height:rect.height}}>
    <header ref={titleRef} tabIndex={0} aria-label="Move decoder with arrow keys; Shift and arrows resize" className="flex min-h-14 shrink-0 cursor-move touch-none items-center gap-2 rounded-t-2xl border-b border-border px-4 focus-visible:ring-2 focus-visible:ring-accent" onPointerDown={e=>start(e,'move')} {...pointer} onKeyDown={e=>{if(e.target===e.currentTarget)titleKeys(e);}}>
      <CircuitBoard size={19} className="shrink-0 text-accent"/><div className="min-w-0 flex-1"><h2 id="component-decoder-title" className="truncate text-sm font-semibold">Component decoder</h2><p className="text-[10px] text-text-secondary">Offline reference · {family}</p></div>
      <button type="button" aria-label="Reset decoder window position" title="Reset window position and size" onClick={()=>setRect(initialRect())} className="rounded p-2 hover:bg-surface-raised"><RotateCcw size={14}/></button>
      <button type="button" aria-label="Minimize decoder" onClick={()=>setMinimized(true)} className="rounded p-2 hover:bg-surface-raised"><Minus size={17}/></button>
      <button type="button" aria-label="Close decoder" title="Close · draft retained" onClick={()=>setVisible(false)} className="rounded p-2 hover:bg-surface-raised"><X size={17}/></button>
    </header>
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      <div className="grid grid-cols-2 gap-2">{(['resistor','capacitor'] as const).map(f=><button type="button" key={f} aria-pressed={family===f} onClick={()=>setFamily(f)} className={`rounded-lg border px-3 py-2 text-sm capitalize ${family===f?'border-accent bg-accent/10 text-accent':'border-border hover:bg-surface-raised'}`}>{f}</button>)}</div>
      <label className="block space-y-1 text-xs text-text-secondary"><span>Marking scheme</span><select className={control} value={draft.scheme} onChange={e=>{const scheme=e.target.value as DecoderScheme;update({scheme,evaluated:false,...(scheme.startsWith('bands')?{bands:defaultBands(Number(scheme.slice(-1)))}:{})});}}>{family==='resistor'?schemes.map(s=><option key={s.id} value={s.id}>{s.label}</option>):<option value="capacitor">Ceramic / film · 3-digit pF code</option>}</select></label>
      {count>0?<div className="space-y-3"><div aria-hidden="true" className="flex h-12 items-center justify-center"><span className="h-0.5 w-7 bg-text-secondary"/><div className="flex h-10 items-center justify-evenly gap-3 rounded-xl border border-border bg-[#d9c6a1] px-5">{draft.bands.map((b,i)=><span key={i} className="h-full w-2.5 border-x border-black/20" style={{background:b==='none'?'transparent':b==='gold'?'#bd931c':b==='silver'?'#bfc2c9':b}}/>)}</div><span className="h-0.5 w-7 bg-text-secondary"/></div><div className="grid grid-cols-2 gap-2">{draft.bands.map((band,i)=>{
        const kind=i<digits?'Digit':i===digits?'Multiplier':i===digits+1?'Tolerance':'TCR';
        const colors=i<digits?BAND_COLORS.slice(i===0?1:0,10):i===digits?BAND_COLORS:i===digits+1?Object.keys(BAND_TOLERANCE).filter(c=>count===4||c!=='none'):Object.keys(BAND_TCR);
        return <label key={i} className="space-y-1 text-xs text-text-secondary"><span>Band {i+1} · {kind}</span><select aria-label={`Band ${i+1} ${kind}`} className={control} value={band} onChange={e=>update({bands:draft.bands.map((b,n)=>n===i?e.target.value:b)})}>{colors.map(c=><option key={c} value={c}>{c==='none'?'No band (20%)':c}{i===digits+1&&c!=='none'?` (±${BAND_TOLERANCE[c]}%)`:i===5?` (${BAND_TCR[c]} ppm/°C)`:''}</option>)}</select></label>;
      })}</div><p className="text-[11px] text-text-secondary">Select colors in reading order. Color names remain visible for every band.</p><button type="button" onClick={()=>update({bands:[...draft.bands].reverse()})} className="rounded border border-border px-2 py-1 text-xs hover:border-accent">Reverse reading direction</button></div>:<label className="block space-y-1 text-xs text-text-secondary"><span>Printed marking</span><input className={control+' font-mono'} maxLength={64} value={draft.marking} placeholder={family==='capacitor'?'104K':draft.scheme==='eia96'?'01C':draft.scheme==='rkm'?'4R7':'103'} onChange={e=>update({marking:e.target.value})} onKeyDown={e=>{if(e.key==='Enter')update({evaluated:true});}} autoComplete="off" spellCheck={false}/></label>}
      <div className="flex gap-2"><button type="button" className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg" onClick={()=>update({evaluated:true})}>Decode marking</button><button type="button" className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-surface-raised" onClick={()=>setDrafts(d=>({...d,[family]:{...defaultDecoderInput(family),evaluated:false}}))}>Clear draft</button></div>
      {decoded.error&&<p role="alert" className="rounded-lg border border-status-danger/40 p-3 text-xs text-status-danger">{decoded.error}</p>}
      {result&&<div aria-live="polite" className="space-y-3 rounded-xl border border-accent/30 bg-accent/5 p-4"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="text-[10px] uppercase tracking-wider text-text-secondary">Decoded nominal value</p><p className="mt-1 break-words text-2xl font-semibold text-accent">{formatComponentValue(result.value,result.unit)}</p></div><button type="button" aria-label="Copy decoded result" title="Copy result" className="rounded p-2 hover:bg-surface-raised" onClick={()=>{const text=`${family}: ${result.marking}\n${formatComponentValue(result.value,result.unit)}\n${result.formula}\nTolerance: ${result.tolerance===null?'unknown':`±${result.tolerance}%`}\n${result.tcr===null?'':`TCR: ${result.tcr} ppm/°C\n`}${DECODER_SOURCES[result.source].url}`;if(!navigator.clipboard?.writeText){setCopyStatus('Clipboard unavailable. Select and copy the result text.');return;}void navigator.clipboard.writeText(text).then(()=>setCopyStatus('Result copied.')).catch(()=>setCopyStatus('Clipboard unavailable. Select and copy the result text.'));}}><Copy size={15}/></button></div><p className="break-words font-mono text-xs">{result.formula}</p><dl className="space-y-1 text-xs"><div>Tolerance: {result.tolerance===null?'Unknown':`±${result.tolerance}%`}</div>{result.minimum!==null&&result.maximum!==null&&<div>Range: {formatComponentValue(result.minimum,result.unit)} – {formatComponentValue(result.maximum,result.unit)}</div>}{result.tcr!==null&&<div>TCR: {result.tcr} ppm/°C</div>}</dl>{result.notes.map(note=><p key={note} className="text-[11px] text-text-secondary">{note}</p>)}<a href={DECODER_SOURCES[result.source].url} target="_blank" rel="noopener noreferrer" className="block text-xs text-accent underline">{DECODER_SOURCES[result.source].name} ↗</a><p className="text-[10px] text-text-secondary">{result.version}</p></div>}
      {copyStatus&&<p role="status" className="text-xs text-text-secondary">{copyStatus}</p>}
      <p className="text-[11px] leading-relaxed text-text-secondary">Reference only. Voltage, power, package and suitability remain unknown. Drafts stay in this account’s current app session; no inventory or lab records are changed.</p>
    </div>
    {(['n','ne','e','se','s','sw','w','nw'] as const).map(edge=><div key={edge} aria-hidden="true" className="absolute touch-none" style={{cursor:`${edge}-resize`,...(edge.includes('n')?{top:-3}:edge.includes('s')?{bottom:-3}:{top:10,bottom:10}),...(edge.includes('w')?{left:-3}:edge.includes('e')?{right:-3}:{left:10,right:10}),...(edge.length===2?{width:12,height:12}:edge==='n'||edge==='s'?{height:6}:{width:6})}} onPointerDown={e=>start(e,edge)} {...pointer}/>)}
  </section>;
}
