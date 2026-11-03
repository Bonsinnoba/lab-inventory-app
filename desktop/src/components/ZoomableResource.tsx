import {useEffect,useLayoutEffect,useRef,useState,ReactNode,WheelEvent,CSSProperties} from 'react';

/** Scale layout dimensions as well as pixels, so every edge remains reachable. */
export default function ZoomableResource({children,zoom,onWheel,center=true,intrinsic=false}:{children:ReactNode;zoom:number;onWheel:(e:WheelEvent<HTMLDivElement>)=>void;center?:boolean;intrinsic?:boolean}){
 const viewport=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null);
 const [bounds,setBounds]=useState({width:0,height:0}),[size,setSize]=useState({width:0,height:0});
 const drag=useRef<{x:number;y:number;left:number;top:number}|null>(null),previous=useRef(zoom);
 useEffect(()=>{const view=viewport.current,node=content.current;if(!view||!node)return;
  const observer=new ResizeObserver(()=>{setBounds({width:view.clientWidth,height:view.clientHeight});setSize({width:node.offsetWidth,height:node.offsetHeight});});observer.observe(view);observer.observe(node);return()=>observer.disconnect();
 },[]);
 const width=Math.max(bounds.width,size.width*zoom+24),height=Math.max(bounds.height,size.height*zoom+24);
 useLayoutEffect(()=>{const view=viewport.current;if(!view)return;const ratio=zoom/previous.current;view.scrollLeft=(view.scrollLeft+view.clientWidth/2)*ratio-view.clientWidth/2;view.scrollTop=(view.scrollTop+view.clientHeight/2)*ratio-view.clientHeight/2;previous.current=zoom;},[zoom]);
 return <div ref={viewport} className="h-full w-full overflow-auto" onWheel={onWheel}
  onPointerDown={e=>{if(zoom<=1||e.button!==0||(e.target as HTMLElement).closest('a,button,input,textarea,select,video,audio'))return;const v=viewport.current!;drag.current={x:e.clientX,y:e.clientY,left:v.scrollLeft,top:v.scrollTop};e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();}}
  onPointerMove={e=>{if(!drag.current)return;const v=viewport.current!,d=drag.current;v.scrollLeft=d.left+d.x-e.clientX;v.scrollTop=d.top+d.y-e.clientY;}}
  onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} style={{cursor:zoom>1?'grab':undefined,touchAction:zoom>1?'none':undefined}}>
  <div style={{position:'relative',width,height}}><div ref={content} style={{position:'absolute',left:Math.max(12,(width-size.width*zoom)/2),top:center?Math.max(12,(height-size.height*zoom)/2):12,width:intrinsic?'max-content':Math.max(1,bounds.width-24),'--resource-viewport-height':`${Math.max(1,bounds.height-24)}px`,transform:`scale(${zoom})`,transformOrigin:'top left'} as CSSProperties}>{children}</div></div>
 </div>;
}
