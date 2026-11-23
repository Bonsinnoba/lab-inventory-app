import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {HashRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import SearchDock from '../../src/components/SearchDock';
import ComponentDecoderWindow from '../../src/components/ComponentDecoderWindow';
import DecoderSearchSuggestions from '../../src/components/DecoderSearchSuggestions';
import CommandPalette from '../../src/components/CommandPalette';
import '../../src/styles/tokens.css';
import '../../src/styles/ui2.css';
if(location.hostname!=='127.0.0.1'||location.port!=='15319')throw Error('Decoder fixture requires isolated origin 15319');
function Fixture(){
  const [query,setQuery]=useState(''),[palette,setPalette]=useState(false),[search,setSearch]=useState(false),[page,setPage]=useState('Inventory'),[account,setAccount]=useState('fixture-a');
  return <main className="min-h-screen bg-bg p-6 text-text-primary"><h1 className="mb-5 text-xl">Component decoder acceptance</h1><div className="max-w-sm space-y-4"><label className="block">Search laboratory<input aria-label="Fixture search" value={query} onChange={e=>setQuery(e.target.value)} className="block w-full rounded border border-border bg-surface p-2"/></label><DecoderSearchSuggestions query={query}/><button className="block border border-border p-2" onClick={()=>setSearch(true)}>Open laboratory search</button><button onClick={()=>setPalette(true)} className="block rounded border border-border p-2">Open command palette</button><button onClick={()=>setPage(p=>p==='Inventory'?'Projects':'Inventory')} className="block rounded border border-border p-2">Navigate workspace</button><p>Workspace: {page}</p><label>Workspace note<input aria-label="Workspace note" className="block rounded border border-border bg-surface p-2"/></label><button className="block border border-border p-2" onClick={()=>setAccount(a=>a==='fixture-a'?'fixture-b':'fixture-a')}>Switch synthetic account</button><p>Account: {account}</p></div><ComponentDecoderWindow key={account} accountId={account}/>{search&&<section role="dialog" aria-label="Fixture laboratory search" className="fixed inset-10 z-[100] rounded-xl border border-border bg-surface"><SearchDock onClose={()=>setSearch(false)} onOpenFull={()=>setSearch(false)}/></section>}<CommandPalette open={palette} onClose={()=>setPalette(false)}/></main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><HashRouter><Fixture/></HashRouter></QueryClientProvider>);
