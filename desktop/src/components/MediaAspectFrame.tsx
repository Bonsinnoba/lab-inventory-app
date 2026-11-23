import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {mediaFrameSize} from '../lib/mediaFrame';

/** Stable wrapper: changing a ratio resizes the frame without remounting its player. */
export default function MediaAspectFrame({aspect='auto',natural=16/9,children}:{aspect?:string;natural?:number;children:ReactNode}){
  const ref=useRef<HTMLDivElement>(null),[bounds,setBounds]=useState({width:1,height:1});
  useLayoutEffect(()=>{
    const node=ref.current;if(!node)return;
    const measure=()=>{const width=node.clientWidth,height=node.clientHeight;setBounds(old=>old.width===width&&old.height===height?old:{width,height});};
    measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();
  },[]);
  const size=mediaFrameSize(bounds.width,bounds.height,aspect,natural);
  return <div ref={ref} className="flex h-full w-full min-h-0 min-w-0 items-center justify-center"><div data-media-aspect={aspect} className="shrink-0 overflow-hidden rounded-md border border-border bg-surface-raised" style={{width:size.width,height:size.height}}>{children}</div></div>;
}
