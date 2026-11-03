import {useEffect,useRef,useState} from 'react';
import {FileText} from 'lucide-react';
const clamp=(n:number,max:number)=>Math.max(8,Math.min(n,Math.max(8,max-64)));
export default function MinimizedResourceViewer({onRestore}:{onRestore:()=>void}){
 const [position,setPosition]=useState({x:Math.max(8,window.innerWidth-88),y:Math.max(8,window.innerHeight-100)});
 const drag=useRef<{x:number;y:number;left:number;top:number;moved:boolean}|null>(null),suppress=useRef(false);
 useEffect(()=>{const resize=()=>setPosition(p=>({x:clamp(p.x,window.innerWidth),y:clamp(p.y,window.innerHeight)}));window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
 return <button type="button" aria-label="Restore resource viewer" title="Resource viewer · drag to move, click to restore" className="fixed z-[120] w-14 h-14 rounded-2xl border border-accent bg-surface text-accent shadow-2xl flex items-center justify-center focus:ring-2 focus:ring-accent" style={{left:position.x,top:position.y,touchAction:'none',cursor:'grab'}}
  onPointerDown={e=>{if(e.button!==0)return;drag.current={x:e.clientX,y:e.clientY,left:position.x,top:position.y,moved:false};suppress.current=false;e.currentTarget.setPointerCapture(e.pointerId);}}
  onPointerMove={e=>{const d=drag.current;if(!d)return;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>4)d.moved=true;if(d.moved)setPosition({x:clamp(d.left+e.clientX-d.x,window.innerWidth),y:clamp(d.top+e.clientY-d.y,window.innerHeight)});}}
  onPointerUp={()=>{suppress.current=!!drag.current?.moved;drag.current=null;}} onPointerCancel={()=>{drag.current=null;suppress.current=true;}}
  onClick={()=>{if(!suppress.current)onRestore();suppress.current=false;}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onRestore();}}}><FileText size={24}/></button>;
}
