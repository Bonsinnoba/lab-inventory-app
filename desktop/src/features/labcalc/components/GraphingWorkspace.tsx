import {useMemo,useState} from 'react';
import type {ChangeEvent} from 'react';
import {Download,Maximize2,RotateCcw} from 'lucide-react';

type Point={x:number;y:number};
type PlotMode='line'|'scatter'|'bar';
const W=760,H=430,LEFT=75,RIGHT=24,TOP=24,BOTTOM=65;
const fmt=(n:number)=>Number(n.toPrecision(5)).toLocaleString('en-US',{maximumFractionDigits:6});
function ticks(lo:number,hi:number){const span=Math.max(hi-lo,1e-12);const raw=span/6;const mag=Math.pow(10,Math.floor(Math.log10(raw)));const step=[1,2,2.5,5,10].map(v=>v*mag).find(v=>v>=raw)||10*mag;const start=Math.ceil(lo/step)*step;const out:number[]=[];for(let i=0;i<100;i++){const v=start+i*step;if(v>hi+step*1e-8)break;out.push(Number(v.toPrecision(12)))}return out}
function bounds(values:number[],includeZero:boolean){let lo=Math.min(...values),hi=Math.max(...values);if(!Number.isFinite(lo)||!Number.isFinite(hi))return [-1,1] as const;if(includeZero){lo=Math.min(0,lo);hi=Math.max(0,hi)}const span=hi-lo||Math.max(Math.abs(hi)*.2,1);const pad=span*.09;return [lo-pad,hi+pad] as const}
function download(name:string,content:string,type:string){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
export default function GraphingWorkspace({compact=false}:{compact?:boolean}){
 const [raw,setRaw]=useState('10,20\n20,35\n30,28\n40,50');
 const [mode,setMode]=useState<PlotMode>('line');
 const [xLabel,setXLabel]=useState('X'),[yLabel,setYLabel]=useState('Y'),[title,setTitle]=useState('Measurement graph');
 const [grid,setGrid]=useState(true),[zero,setZero]=useState(false),[trend,setTrend]=useState(false),[sort,setSort]=useState(true);
 const [zoom,setZoom]=useState(1);
 const parsed=useMemo(()=>{const points:Point[]=[];const errors:number[]=[];raw.split(/\r?\n/).forEach((line,i)=>{if(!line.trim()||/^\s*(x\s*[,;\t]\s*y|#)/i.test(line))return;const parts=line.trim().split(/[,;\t]+/).map(s=>s.trim());if(parts.length!==2||parts.some(s=>!s||!Number.isFinite(Number(s)))){errors.push(i+1);return}points.push({x:Number(parts[0]),y:Number(parts[1])})});return {points,errors}},[raw]);
 const points=useMemo(()=>sort?[...parsed.points].sort((a,b)=>a.x-b.x):parsed.points,[parsed.points,sort]);
 const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
 const [baseX0,baseX1]=bounds(xs,zero),[baseY0,baseY1]=bounds(ys,zero);
 const midX=(baseX0+baseX1)/2,midY=(baseY0+baseY1)/2;
 const x0=midX-(baseX1-baseX0)/(2*zoom),x1=midX+(baseX1-baseX0)/(2*zoom),y0=midY-(baseY1-baseY0)/(2*zoom),y1=midY+(baseY1-baseY0)/(2*zoom);
 const px=(x:number)=>LEFT+(x-x0)/(x1-x0)*(W-LEFT-RIGHT),py=(y:number)=>H-BOTTOM-(y-y0)/(y1-y0)*(H-TOP-BOTTOM);
 const xt=ticks(x0,x1),yt=ticks(y0,y1);
 const n=points.length,sumX=xs.reduce((a,b)=>a+b,0),sumY=ys.reduce((a,b)=>a+b,0);
 const meanX=n?sumX/n:0,meanY=n?sumY/n:0;
 const sxx=points.reduce((a,p)=>a+(p.x-meanX)**2,0),sxy=points.reduce((a,p)=>a+(p.x-meanX)*(p.y-meanY),0);
 const slope=n>1&&sxx>0?sxy/sxx:null,intercept=slope===null?null:meanY-slope*meanX;
 const syy=points.reduce((a,p)=>a+(p.y-meanY)**2,0);
 const r2=slope===null||syy===0?null:Math.min(1,Math.max(0,sxy*sxy/(sxx*syy)));
 const [hover,setHover]=useState<number|null>(null);
 const [fileError,setFileError]=useState('');
 const readFile=async(e:ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(!f)return;if(f.size>1024*1024){setFileError('Maximum file size is 1 MB');return}setRaw(await f.text());setFileError('');e.target.value=''};
 const svg=<svg id="labcalc-graph-svg" xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${n} plotted points, horizontal axis ${xLabel}, vertical axis ${yLabel}`} className="block w-full h-auto min-w-0" style={{fontFamily:'system-ui, sans-serif'}}>
  <defs><clipPath id="labcalc-plot-clip"><rect x={LEFT} y={TOP} width={W-LEFT-RIGHT} height={H-TOP-BOTTOM}/></clipPath></defs>
  <rect x={0} y={0} width={W} height={H} fill="#17191e" rx={8}/>
  {grid&&xt.map(v=><line key={'gx'+v} x1={px(v)} x2={px(v)} y1={TOP} y2={H-BOTTOM} stroke="#444954" strokeWidth=".8" strokeDasharray="3 4"/>)}
  {grid&&yt.map(v=><line key={'gy'+v} x1={LEFT} x2={W-RIGHT} y1={py(v)} y2={py(v)} stroke="#444954" strokeWidth=".8" strokeDasharray="3 4"/>)}
  <path d={`M${LEFT},${TOP}V${H-BOTTOM}H${W-RIGHT}`} fill="none" stroke="#c1c7d1" strokeWidth="1.3"/>
  {xt.map(v=><g key={'x'+v}><line x1={px(v)} x2={px(v)} y1={H-BOTTOM} y2={H-BOTTOM+5} stroke="#c1c7d1"/><text x={px(v)} y={H-BOTTOM+20} fontSize="11" textAnchor="middle" fill="#c1c7d1">{fmt(v)}</text></g>)}
  {yt.map(v=><g key={'y'+v}><line x1={LEFT-5} x2={LEFT} y1={py(v)} y2={py(v)} stroke="#c1c7d1"/><text x={LEFT-10} y={py(v)+4} fontSize="11" textAnchor="end" fill="#c1c7d1">{fmt(v)}</text></g>)}
  <text x={(LEFT+W-RIGHT)/2} y={H-14} fontSize="14" textAnchor="middle" fill="#e5e7eb">{xLabel}</text>
  <text transform={`translate(18 ${(TOP+H-BOTTOM)/2}) rotate(-90)`} fontSize="14" textAnchor="middle" fill="#e5e7eb">{yLabel}</text>
  <g clipPath="url(#labcalc-plot-clip)">
  {mode==='line'&&points.length>1&&<polyline fill="none" stroke="#83a7ff" strokeWidth="2.5" strokeLinejoin="round" points={points.map(p=>`${px(p.x)},${py(p.y)}`).join(' ')}/>}
  {mode==='bar'&&points.map((p,i)=><rect key={i} x={px(p.x)-Math.max(2,Math.min(22,(W-LEFT-RIGHT)/Math.max(2,n)*.32))} y={Math.min(py(p.y),py(Math.max(y0,Math.min(y1,0))))} width={Math.max(4,Math.min(44,(W-LEFT-RIGHT)/Math.max(2,n)*.64))} height={Math.abs(py(p.y)-py(Math.max(y0,Math.min(y1,0))))} fill="#83a7ff" opacity=".8"/>)}
  {trend&&slope!==null&&intercept!==null&&<line x1={px(x0)} y1={py(slope*x0+intercept)} x2={px(x1)} y2={py(slope*x1+intercept)} stroke="#f6c96c" strokeWidth="2" strokeDasharray="7 5"/>}
  {points.map((p,i)=><circle key={i} cx={px(p.x)} cy={py(p.y)} r={hover===i?6:4} fill={hover===i?'#fff':'#83a7ff'} stroke="#17191e" strokeWidth="1.5" onMouseEnter={()=>setHover(i)} onMouseLeave={()=>setHover(null)}><title>{`(${fmt(p.x)}, ${fmt(p.y)})`}</title></circle>)}
  </g>
  {hover!==null&&points[hover]&&<g><rect x={W-195} y={TOP+8} width="170" height="29" rx="5" fill="#303744"/><text x={W-110} y={TOP+27} fontSize="12" textAnchor="middle" fill="white">{`(${fmt(points[hover].x)}, ${fmt(points[hover].y)})`}</text></g>}
 </svg>;
 return <div className={compact?'space-y-3':'grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(210px,0.3fr)_minmax(0,1fr)] gap-4 overflow-hidden'}>
  <section className={compact?"min-w-0 rounded-xl border border-border bg-surface-raised p-3 space-y-3":"labcalc-graph-settings min-w-0 min-h-0 h-full overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface-raised p-3 space-y-3"}>
   <div><h3 className="text-sm font-semibold">Graph data & settings</h3><p className="text-xs text-text-secondary mt-1">Enter x,y pairs, one per line. Negative and decimal values are supported.</p></div>
   <label className="block text-xs font-medium">Values<textarea aria-label="Graph values" value={raw} onChange={e=>setRaw(e.target.value)} spellCheck={false} className="mt-1 w-full min-h-36 rounded-lg border border-border bg-bg p-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent/50" placeholder="x,y"/></label>
   {parsed.errors.length>0&&<p role="alert" className="text-xs text-status-danger">Invalid rows: {parsed.errors.join(', ')}. These rows are skipped.</p>}
   <div className="flex items-center justify-between gap-2 text-xs"><span>{n} valid points</span><label className="cursor-pointer rounded-md border border-border px-2 py-1.5 hover:bg-bg">Import CSV / TSV<input type="file" accept=".csv,.tsv,.txt,text/plain,text/csv" className="sr-only" onChange={readFile}/></label></div>
   {fileError&&<p role="alert" className="text-xs text-status-danger">{fileError}</p>}
   <label className="block text-xs">Chart type<select value={mode} onChange={e=>setMode(e.target.value as PlotMode)} className="mt-1 w-full rounded-md border border-border bg-bg p-2"><option value="line">Line</option><option value="scatter">Scatter</option><option value="bar">Bar</option></select></label>
   <label className="block text-xs">Title<input value={title} onChange={e=>setTitle(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg p-2"/></label>
   <div className="grid grid-cols-2 gap-2"><label className="text-xs">X axis<input value={xLabel} onChange={e=>setXLabel(e.target.value)} className="mt-1 w-full min-w-0 rounded-md border border-border bg-bg p-2"/></label><label className="text-xs">Y axis<input value={yLabel} onChange={e=>setYLabel(e.target.value)} className="mt-1 w-full min-w-0 rounded-md border border-border bg-bg p-2"/></label></div>
   <div className="grid grid-cols-2 gap-2 text-xs">{[[grid,setGrid,'Grid lines'],[zero,setZero,'Include zero'],[trend,setTrend,'Trendline'],[sort,setSort,'Sort by X']].map(([value,set,label])=><label key={label as string} className="flex items-center gap-2"><input type="checkbox" checked={value as boolean} onChange={e=>(set as (v:boolean)=>void)(e.target.checked)}/>{label as string}</label>)}</div>
   <div className="flex flex-wrap gap-2"><button type="button" className="rounded-md border border-border px-2 py-1.5 text-xs" onClick={()=>setZoom(z=>Math.min(8,z*1.5))}>Zoom +</button><button type="button" className="rounded-md border border-border px-2 py-1.5 text-xs" onClick={()=>setZoom(z=>Math.max(.25,z/1.5))}>Zoom −</button><button type="button" title="Fit data" aria-label="Fit data" className="rounded-md border border-border px-2 py-1.5" onClick={()=>setZoom(1)}><Maximize2 size={15}/></button><button type="button" title="Reset settings" aria-label="Reset graph settings" className="rounded-md border border-border px-2 py-1.5" onClick={()=>{setZoom(1);setGrid(true);setZero(false);setTrend(false);setSort(true)}}><RotateCcw size={15}/></button></div>
   <div className="flex gap-2"><button type="button" className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs" onClick={()=>download('labcalc-graph.csv','x,y\n'+points.map(p=>`${p.x},${p.y}`).join('\n'),'text/csv')}><Download size={13}/> CSV</button><button type="button" className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs" onClick={()=>download('labcalc-graph.svg',new XMLSerializer().serializeToString(document.getElementById('labcalc-graph-svg')!),'image/svg+xml')}><Download size={13}/> SVG</button></div>
  </section>
  <section className={compact?"min-w-0 rounded-xl border border-border bg-surface p-3":"min-w-0 min-h-0 h-full overflow-y-auto rounded-xl border border-border bg-surface p-3 sm:p-4"}><div className="flex flex-wrap items-center justify-between gap-2 mb-3"><h3 className="text-base font-semibold">{title||'Graph preview'}</h3><span className="text-xs text-text-secondary">{mode} · {n} points</span></div><div className="rounded-lg border border-border bg-bg overflow-hidden">{svg}</div>{n>0&&<div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">{[['X range',`${fmt(Math.min(...xs))} to ${fmt(Math.max(...xs))}`],['Y range',`${fmt(Math.min(...ys))} to ${fmt(Math.max(...ys))}`],['Mean Y',fmt(meanY)],['Trend R²',r2===null?'N/A':fmt(r2)]].map(([label,value])=><div key={label} className="rounded-md border border-border bg-surface-raised p-2"><div className="text-text-secondary">{label}</div><div className="font-medium mt-1 break-words">{value}</div></div>)}</div>}{trend&&slope!==null&&<p className="mt-2 text-xs text-text-secondary">Linear fit: y = {fmt(slope)}x {intercept!>=0?'+':'−'} {fmt(Math.abs(intercept!))}</p>}{n===0&&<p className="mt-2 text-xs text-text-secondary">Enter valid coordinates to plot your data.</p>}</section>
 </div>;
}
