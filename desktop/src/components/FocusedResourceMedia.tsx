import {useEffect,useRef} from 'react';
import {ResourceMediaFocus} from '../lib/resourceMediaFocus';

export default function FocusedResourceMedia({kind,src,poster,aspect='auto'}:{kind:'video'|'audio';src:string;poster?:string;aspect?:string}){
 const ref=useRef<HTMLVideoElement&HTMLAudioElement>(null);
 useEffect(()=>{if(!ref.current)return;const controller=new ResourceMediaFocus(ref.current);return()=>controller.dispose();},[src,kind]);
 return kind==='video'
  ?<video ref={ref} controls preload="metadata" poster={poster} src={src} className="max-h-full max-w-full" style={{width:'100%',aspectRatio:aspect==='auto'?undefined:aspect,objectFit:'contain'}}/>
  :<audio ref={ref} controls src={src} className="w-full max-w-xl"/>;
}
