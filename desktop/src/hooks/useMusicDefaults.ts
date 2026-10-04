import { useEffect } from 'react';
import { getDailyUsePreferences } from '../api/system';

export function useMusicDefaults(setVolume:(value:number)=>void){
  useEffect(()=>{
    let active=true;
    void getDailyUsePreferences().then(p=>{if(active)setVolume(p.music_volume);}).catch(()=>undefined);
    const changed=(event:Event)=>setVolume((event as CustomEvent).detail.music_volume);
    window.addEventListener('labos:daily-preferences-changed',changed);
    return()=>{active=false;window.removeEventListener('labos:daily-preferences-changed',changed);};
  },[setVolume]);
}
