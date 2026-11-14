import {onlineManager} from '@tanstack/react-query';
let locked=false;
const native=()=>typeof window!=='undefined'&&!!(window as any).__TAURI_IPC__;
const available=()=>!locked&&(native()||typeof navigator==='undefined'||navigator.onLine);
// SQLite queries remain runnable when the network adapter itself is offline.
// Expired authentication is a distinct lock and pauses all ordinary queries.
export function installQueryAvailability(){onlineManager.setEventListener(setOnline=>{const update=()=>setOnline(available());if(typeof window==='undefined'){update();return;}window.addEventListener('online',update);window.addEventListener('offline',update);update();return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};});}
export function lockQueryAvailability(){locked=true;onlineManager.setOnline(false);}
export function unlockQueryAvailability(){locked=false;onlineManager.setOnline(available());}
