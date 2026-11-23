import {useEffect,useRef,useState} from 'react';
import {ResourceMediaFocus} from '../lib/resourceMediaFocus';
import {type MediaDisplayFit} from '../lib/mediaFrame';
import MediaAspectFrame from './MediaAspectFrame';

export default function FocusedResourceMedia({kind,src,poster,aspect='auto',fit='contain'}:{kind:'video'|'audio';src:string;poster?:string;aspect?:string;fit?:MediaDisplayFit}){
 const ref=useRef<HTMLVideoElement&HTMLAudioElement>(null);
 const [natural,setNatural]=useState(16/9);
 useEffect(()=>setNatural(16/9),[src]);
 useEffect(()=>{if(!ref.current)return;const controller=new ResourceMediaFocus(ref.current);return()=>controller.dispose();},[src,kind]);
 return kind==='video'
  ?<MediaAspectFrame aspect={aspect} natural={natural}><video ref={ref} controls preload="metadata" poster={poster} src={src} onLoadedMetadata={event=>{const media=event.currentTarget;if(media.videoWidth&&media.videoHeight)setNatural(media.videoWidth/media.videoHeight);}} className="h-full w-full" data-media-fit={fit} style={{objectFit:fit}}/></MediaAspectFrame>
  :<audio ref={ref} controls src={src} className="w-full max-w-xl"/>;
}
