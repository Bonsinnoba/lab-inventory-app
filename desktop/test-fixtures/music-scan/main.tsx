import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import MusicLibraryBrowser from '../../src/components/MusicLibraryBrowser';
import {ToastProvider} from '../../src/contexts/ToastContext';
import {ThemeProvider} from '../../src/contexts/ThemeContext';
import '../../src/styles/tokens.css';
import '../../src/styles/ui2.css';
if(location.hostname!=='127.0.0.1'||location.port!=='15320')throw Error('Music scan fixture requires isolated port 15320');
function Fixture(){
 const [status,setStatus]=useState('No library writes or reloads');
 function drop(large:boolean){
  const selected=new File(['synthetic'],'Selection.wav',{type:'audio/wav'});
  const root={name:'Synthetic folder',isFile:false,isDirectory:true,createReader:()=>({readEntries(resolve:(value:unknown[])=>void){if(large)resolve(Array.from({length:10001},(_,i)=>({name:`${i}.wav`,isFile:true,isDirectory:false})));/* otherwise deliberately never completes */}})};
  const event=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{types:['Files'],items:[{kind:'file',webkitGetAsEntry:()=>root}],files:[selected]}});
  document.querySelector('.music-library-browser')!.dispatchEvent(event);
 }
 return <ToastProvider><main className="min-h-screen bg-bg p-4 text-text-primary"><h1>Music discovery acceptance · synthetic drop callbacks</h1><div className="my-3 flex gap-4 text-xs"><button onClick={()=>drop(false)}>Start stalled folder drop</button><button onClick={()=>drop(true)}>Start oversized folder drop</button></div><p role="status">{status}</p><div style={{width:360,height:650,position:'relative'}}><MusicLibraryBrowser tracks={[]} playlists={[]} state={{id:'player',activeId:null,queues:[]}} currentId={null} isPlaying={false} loading={false} error={false} onNowPlaying={()=>{}} reload={async()=>setStatus('Unexpected library reload')} change={()=>setStatus('Unexpected queue write')} play={()=>{}} source={()=>{}} enqueue={()=>{}} remove={async()=>setStatus('Unexpected removal')}/></div></main></ToastProvider>;
}
createRoot(document.getElementById('root')!).render(<ThemeProvider><Fixture/></ThemeProvider>);
