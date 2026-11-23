import {ThemeProvider,useTheme} from '../../src/contexts/ThemeContext';
// Dedicated origin, synthetic bytes, no credentials or desktop data. Never a production entry.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import MusicDock from '../../src/components/MusicDock';
import { ToastProvider } from '../../src/contexts/ToastContext';
import { deleteMusicTrack, identifyExistingMusic, insertMusic, musicContentId, musicLibrary, musicRead, musicWrite, updateMusicTags, updateMusicArtwork } from '../../src/lib/musicLibrary';
import '../../src/styles/tokens.css';
import '../../src/styles/ui2.css';
if (location.hostname !== '127.0.0.1' || location.port !== '15317')
    throw new Error('Music fixture requires its dedicated disposable origin');
const checks: string[] = [];
function check(value: unknown, label: string) { if (!value)
    throw new Error(label); checks.push(`PASS: ${label}`); }
function wav(frequency: number) { const rate = 8000, count = rate * 30, buffer = new ArrayBuffer(44 + count * 2), view = new DataView(buffer); const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0))); text(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, count * 2, true); for (let i = 0; i < count; i++)
    view.setInt16(44 + i * 2, Math.sin(i * frequency / rate * Math.PI * 2) * 200, true); return new Blob([buffer], { type: 'audio/wav' }); }
async function setup() {
    const marker = await new Promise<boolean>((resolve, reject) => { const request = indexedDB.open('music-fixture-marker', 1); request.onupgradeneeded = () => request.result.createObjectStore('markers'); request.onsuccess = () => { const db = request.result, tx = db.transaction('markers', 'readwrite'), r = tx.objectStore('markers').get('seeded'); let exists = false; r.onsuccess = () => { exists = !!r.result; if (!exists)
        tx.objectStore('markers').put(true, 'seeded'); }; tx.oncomplete = () => { db.close(); resolve(exists); }; tx.onerror = () => reject(tx.error); }; request.onerror = () => reject(request.error); });
    if (marker) {
        document.getElementById('results')!.textContent = 'Reopened existing disposable music session';
        return;
    }
    const one = wav(220), two = wav(330);
    await new Promise<void>((resolve, reject) => { const request = indexedDB.open('labos-local-media', 2); request.onupgradeneeded = () => { request.result.createObjectStore('tracks', { keyPath: 'id' }); request.result.createObjectStore('playlists', { keyPath: 'id' }); }; request.onsuccess = () => { const db = request.result, tx = db.transaction(['tracks', 'playlists'], 'readwrite'); tx.objectStore('tracks').put({ id: 'one', name: 'One.wav', blob: one, addedAt: 1, collectionId: 'folder', collectionName: 'Lab music', relativePath: 'Album/One.wav' }); tx.objectStore('tracks').put({ id: 'two', name: 'Two.wav', blob: two, addedAt: 2, collectionId: 'folder', collectionName: 'Lab music', relativePath: 'Album/Disc 2/Two.wav' }); tx.objectStore('playlists').put({ id: 'legacy', name: 'Legacy playlist', trackIds: ['one', 'two'], createdAt: 1 }); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; request.onerror = () => reject(request.error); });
    const legacy = await musicLibrary();
    check(legacy.tracks.length === 2 && legacy.playlists.length === 1, 'v2 library survives additive v3 migration');
    check(!('blob' in legacy.tracks[0]), 'library metadata does not retain audio blobs');
    for (const track of legacy.tracks) {
        const stored = await musicRead<any>('tracks', track.id);
        await identifyExistingMusic(track, await musicContentId(stored.blob));
    }
    const contentId = await musicContentId(one);
    check(!await insertMusic({ id: 'renamed', name: 'Different name.wav', blob: one, contentId }), 'renamed identical content is not reimported');
    const three = wav(440), thirdHash = await musicContentId(three);
    const concurrent = await Promise.all(['three', 'three-alias'].map(id => insertMusic({ id, name: 'Three.wav', blob: three, contentId: thirdHash })));
    check(concurrent.filter(Boolean).length === 1, 'concurrent imports atomically admit a single content identity');
    const state = { id: 'player' as const, activeId: 'q', queues: [{ id: 'q', name: 'Saved queue', trackIds: ['one', 'two'], currentId: 'one', position: 12, shuffle: false, repeat: 'off' as const }] };
    await musicWrite('state', state);
    check((await musicRead<any>('state', 'player'))?.queues[0].position === 12, 'queue and song position persist after transaction commit');
    await deleteMusicTrack('two');
    const after = await musicLibrary();
    check(after.tracks.length === 2 && !after.playlists[0].trackIds.includes('two') && !(await musicRead<any>('state', 'player')).queues[0].trackIds.includes('two'), 'track removal atomically updates playlists and queues');
    await musicWrite('tracks', { id: 'two', name: 'Two.wav', blob: two, contentId: await musicContentId(two), addedAt: 2, collectionId: 'folder', collectionName: 'Lab music', relativePath: 'Album/Disc 2/Two.wav' });
    await musicWrite('playlists', legacy.playlists[0]);
    await musicWrite('state', state);
    document.getElementById('results')!.textContent = checks.join('\n');
}
function Fixture(){
  const [open,setOpen]=useState(true),[width,setWidth]=useState(300);const {setTheme}=useTheme();
  return <ToastProvider><div className="flex flex-wrap gap-3 p-2 text-xs"><button onClick={()=>setOpen(value=>!value)}>{open?'Close fixture player':'Reopen fixture player'}</button><button onClick={()=>setWidth(300)}>300px dock</button><button onClick={()=>setWidth(360)}>360px panel</button><button onClick={()=>setTheme({mode:'dark',color:'default',background:'tinted'})}>Tinted</button><button onClick={()=>setTheme({mode:'dark',color:'default',background:'plain'})}>Pure black</button><button onClick={()=>setTheme({mode:'light',color:'purple',background:'plain'})}>Pure white</button></div>{open&&<div style={{height:651,width,position:'relative',border:'1px solid var(--color-border)'}}><MusicDock onClose={()=>setOpen(false)} onMinimize={()=>{}} onRestore={()=>{}} autoPause/></div>}</ToastProvider>;
}
Object.assign(document.getElementById('results')!.style,{whiteSpace:'pre-wrap',fontSize:'9px',maxHeight:'30px',overflow:'auto'});
const fixtureRoot=import.meta.hot?.data.root||createRoot(document.getElementById('root')!);
if(import.meta.hot)import.meta.hot.data.root=fixtureRoot;
setup().then(async()=>{
 const original=await musicRead<any>('tracks','one');
 check(!await updateMusicTags('never-existing-track',{title:'Must not be created'}),'tag enrichment does not resurrect a missing song');
 await updateMusicTags('one',{title:'Late night circuits',artist:'Demo artist',album:'Bench notes'});
 const enriched=await musicRead<any>('tracks','one');
 check(original.contentId===enriched.contentId&&await musicContentId(original.blob)===await musicContentId(enriched.blob),'tag enrichment preserves audio identity and bytes');
 check(!await updateMusicArtwork('never-existing-track',new Blob(['cover'],{type:'image/png'})),'cover caching never recreates a missing song');
 await updateMusicArtwork('one',new Blob(['cover'],{type:'image/png'}));
 let cached=await musicRead<any>('tracks','one');
 check(cached.artworkChecked&&cached.artwork.size===5&&cached.title==='Late night circuits','cover transaction preserves current tags');
 await updateMusicArtwork('one');cached=await musicRead<any>('tracks','one');
 check(cached.artworkChecked&&!cached.artwork,'absence of embedded cover is cached');
 await updateMusicArtwork('one',new Blob([new Uint8Array(4*1024*1024+1)],{type:'image/png'}));
 check(!(await musicRead<any>('tracks','one')).artwork,'oversize cover is not retained');
 await updateMusicArtwork('one',new Blob(['<svg/>'],{type:'image/svg+xml'}));
 cached=await musicRead<any>('tracks','one');
 check(!cached.artwork&&cached.contentId===original.contentId&&await musicContentId(cached.blob)===await musicContentId(original.blob),'unsupported covers leave audio bytes and identity unchanged');
 document.getElementById('results')!.textContent=checks.join(' · ');fixtureRoot.render(<ThemeProvider><Fixture/></ThemeProvider>);
}).catch(error => { document.getElementById('results')!.textContent = `FAIL: ${error.message}`; });
