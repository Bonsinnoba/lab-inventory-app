import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeProvider,useTheme} from '../../src/contexts/ThemeContext';
import ThemeSelector from '../../src/components/ThemeSelector';
import ResourceViewerModal from '../../src/components/ResourceViewerModal';
import type {Resource} from '../../src/api/resources';
import '../../src/styles/tokens.css';
import '../../src/styles/ui2.css';
if(location.hostname!=='127.0.0.1'||location.port!=='15318')throw new Error('Appearance fixture requires its dedicated origin');
const resource={id:'appearance-fixture',kind:'file',name:'Appearance sample.dat',original_filename:'Appearance sample.dat',file_type:'other',created_at:'2026-11-17T00:00:00Z',updated_at:'2026-11-17T00:00:00Z'} as Resource;
function Fixture(){
  const [viewer,setViewer]=useState(false);const {theme,setTheme}=useTheme();
  return <main className="min-h-screen bg-bg p-5 text-text-primary">
    <h1 className="mb-4 text-lg">Isolated appearance acceptance — synthetic resource</h1>
    <div className="max-w-xl rounded-lg border border-border bg-surface p-4"><ThemeSelector/></div>
    <div className="dashboard-hero my-4 rounded-lg p-4" data-testid="appearance-shell">Background preview · chosen accent remains independent</div>
    <output className="block text-xs" aria-label="Appearance state">{JSON.stringify(theme)}</output>
    <button className="my-4 rounded bg-accent px-3 py-2 text-bg" onClick={()=>setViewer(true)}>Open resource viewer</button>
    {viewer&&<ResourceViewerModal resource={resource} onClose={()=>setViewer(false)}/>}
    {viewer&&<div style={{position:'fixed',bottom:8,left:8,zIndex:2000}} className="flex gap-2 rounded border border-border bg-surface p-2 text-xs" aria-label="Live appearance test controls">
      <button onClick={()=>setTheme({mode:'light',color:'purple',background:'plain'})}>Test pure white</button>
      <button onClick={()=>setTheme({mode:'dark',color:'green',background:'plain'})}>Test pure black</button>
      <button onClick={()=>setTheme({mode:'dark',color:'pink',background:'custom',customBackground:'#123456',customAccent:'#FFAA00'})}>Test custom</button>
      <button onClick={()=>setTheme({mode:'light',color:'purple',background:'tinted'})}>Test tinted</button>
    </div>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<ThemeProvider><Fixture/></ThemeProvider>);
