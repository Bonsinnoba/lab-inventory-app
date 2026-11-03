import {useCallback,useEffect,useRef,MutableRefObject} from 'react';
import {MusicTransport} from '../lib/musicTransport';

export function useMusicTransport(audio:MutableRefObject<HTMLAudioElement|null>,options:{source:string;id:string|null;volume:number;autoPause:boolean;ownerId:string;playing:(value:boolean)=>void;reset:()=>void;error:(message:string)=>void}){
 const latest=useRef(options);latest.current=options;
 const transport=useRef<MusicTransport|null>(null);
 const bind=useCallback((node:HTMLAudioElement|null)=>{
  transport.current?.dispose();transport.current=null;audio.current=node;
  if(node){
   const t=new MusicTransport(node,{playing:value=>latest.current.playing(value),reset:()=>latest.current.reset(),error:message=>latest.current.error(message)},undefined,latest.current.ownerId);
   transport.current=t;node.volume=latest.current.volume;t.setAutoPause(latest.current.autoPause);t.select(latest.current.id,latest.current.source,false,false,false);
  }
 },[audio]);
 useEffect(()=>{if(!transport.current&&audio.current)bind(audio.current);return()=>{transport.current?.dispose();transport.current=null;};},[audio,bind]);
 useEffect(()=>{const t=transport.current;t?.select(options.id,options.source,t.wantsPlayback,false,false);},[options.id,options.source]);
 useEffect(()=>{transport.current?.setAutoPause(options.autoPause);},[options.autoPause]);
 useEffect(()=>{if(audio.current)audio.current.volume=options.volume;},[audio,options.volume]);
 useEffect(()=>{const pause=()=>transport.current?.suspendLegacy(),resume=()=>transport.current?.resumeLegacy();window.addEventListener('labos:pause-music',pause);window.addEventListener('labos:resume-music',resume);return()=>{window.removeEventListener('labos:pause-music',pause);window.removeEventListener('labos:resume-music',resume);};},[]);
 return {bind,transport};
}
