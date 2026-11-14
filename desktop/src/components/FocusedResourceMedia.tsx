import {useEffect,useRef,useState} from 'react';
import {ResourceMediaFocus} from '../lib/resourceMediaFocus';
import {mediaFrameSize} from '../lib/mediaFrame';

export default function FocusedResourceMedia({kind,src,poster,aspect='auto'}:{kind:'video'|'audio';src:string;poster?:string;aspect?:string}){
 const ref=useRef<HTMLVideoElement&HTMLAudioElement>(null);
 const frame=useRef<HTMLDivElement>(null);
 const [bounds,setBounds]=useState({width:0,height:0});
 const [natural,setNatural]=useState(16/9);
 useEffect(()=>{const node=frame.current;if(!node)return;const observer=new ResizeObserver(()=>setBounds({width:node.clientWidth,height:node.clientHeight}));observer.observe(node);return()=>observer.disconnect();},[kind]);
 useEffect(()=>setNatural(16/9),[src]);
 useEffect(()=>{if(!ref.current)return;const controller=new ResourceMediaFocus(ref.current);return()=>controller.dispose();},[src,kind]);
 const size=mediaFrameSize(bounds.width,bounds.height,aspect,natural);
 return kind==='video'
  ?<div ref={frame} className="flex h-full w-full min-h-0 items-center justify-center"><video ref={ref} controls preload="metadata" poster={poster} src={src} onLoadedMetadata={event=>{const media=event.currentTarget;if(media.videoWidth&&media.videoHeight)setNatural(media.videoWidth/media.videoHeight);}} className="rounded-md border border-slate-800 bg-black object-contain" style={{width:size.width,height:size.height}}/></div>
  :<audio ref={ref} controls src={src} className="w-full max-w-xl"/>;
}
