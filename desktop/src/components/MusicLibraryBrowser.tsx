import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronRight, ChevronUp, FolderOpen, GripVertical, Headphones, Library, ListMusic, ListPlus, Loader2, MoreHorizontal, Music2, Play, Plus, Search, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { deleteMusicPlaylist, identifyExistingMusic, insertMusic, moveMusicId, musicContentId, musicFolderEntries, musicPage, musicRead, musicWrite, uniqueMusicIds } from '../lib/musicLibrary';
import {droppedMusicFiles,pickedMusicFiles,type MusicImportFile} from '../lib/musicImport';
import type { MusicPlaylist, MusicQueue, MusicState, MusicTrack, StoredMusicTrack } from '../lib/musicLibrary';
type Props = {
    tracks: MusicTrack[];
    playlists: MusicPlaylist[];
    state: MusicState;
    currentId: string | null;
    isPlaying: boolean;
    onNowPlaying: () => void;
    loading: boolean;
    error: boolean;
    reload: () => Promise<void>;
    change: (state: MusicState) => void;
    play: (id: string, queueId?: string) => void;
    source: (name: string, key: string, ids: string[], mode: 'resume' | 'replace' | 'merge', shuffled?: boolean) => void;
    enqueue: (ids: string[], where: 'next' | 'end') => void;
    remove: (id: string) => Promise<void>;
};
type ImportFile = MusicImportFile;
const audioExtensions = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'alac', 'webm']);
const isAudio = (file: File) => file.type.startsWith('audio/') || audioExtensions.has(file.name.split('.').pop()?.toLowerCase() || '');
function MusicLibraryBrowser(p: Props) {
    const { showToast } = useToast();
    const [tab, setTab] = useState<'folders' | 'songs' | 'queues' | 'playlists'>('folders');
    const [collection, setCollection] = useState<string | null>(null), [path, setPath] = useState(''), [flat, setFlat] = useState(false);
    const [importOpen,setImportOpen]=useState(false);
    const [search, setSearch] = useState(''), [selected, setSelected] = useState<string[]>([]), [playlistId, setPlaylistId] = useState('');
    const [name, setName] = useState(''), [progress, setProgress] = useState(''), [dragging, setDragging] = useState(false);
    const [choice, setChoice] = useState<{
        name: string;
        key: string;
        ids: string[];
        shuffled?: boolean;
    } | null>(null);
    const [review, setReview] = useState<ImportFile[] | null>(null), [removeChoice, setRemoveChoice] = useState<MusicTrack | null>(null);
    const [selectionName, setSelectionName] = useState('');
    const [trackMenu,setTrackMenu]=useState<string|null>(null);
    const [newQueueOpen,setNewQueueOpen]=useState(false),[newPlaylistOpen,setNewPlaylistOpen]=useState(false),[queueOptionsOpen,setQueueOptionsOpen]=useState(false);
    const [importResult,setImportResult]=useState<{imported:number;duplicates:number;skipped:number;stopped:boolean}|null>(null);
    const dragged = useRef<{
        source: string;
        id: string;
    } | null>(null);
    const importer = useRef<AbortController | null>(null),scanner=useRef<AbortController|null>(null),alive=useRef(true);
    const contentArea=useRef<HTMLDivElement>(null);
    const filesInput=useRef<HTMLInputElement>(null),folderInput=useRef<HTMLInputElement>(null);
    useEffect(() => {alive.current=true;return()=>{alive.current=false;importer.current?.abort();scanner.current?.abort();scanner.current=null;};}, []);
    useLayoutEffect(()=>{
        if(!review&&!choice&&!removeChoice)return;
        const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
        if(contentArea.current)contentArea.current.scrollTop=0;
        contentArea.current?.querySelector<HTMLButtonElement>('[role="dialog"] button')?.focus({preventScroll:true});
        return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};
    },[review,choice,removeChoice]);
    useEffect(()=>{if(importResult&&contentArea.current)contentArea.current.scrollTop=0;},[importResult]);

    useEffect(() => { setSelected([]);setTrackMenu(null); }, [tab, collection, path]);
    const displayTracks = useMemo(() => { const ids = new Set(uniqueMusicIds(p.tracks.map(track => track.id), p.tracks)); return p.tracks.filter(track => ids.has(track.id)); }, [p.tracks]);
    const trackMap = useMemo(() => new Map(p.tracks.map(t => [t.id, t])), [p.tracks]);
    const active = p.state.queues.find(q => q.id === p.state.activeId);
    const collectionTracks = useMemo(() => displayTracks.filter(t => (t.collectionId || 'imported-files') === collection).sort((a, b) => (a.relativePath || a.name).localeCompare(b.relativePath || b.name, undefined, { numeric: true })), [displayTracks, collection]);
    const entries = useMemo(() => musicFolderEntries(collectionTracks, path, search, flat), [collectionTracks, path, search, flat]);
    const visible = tab === 'songs' ? displayTracks.filter(t => `${t.name} ${t.title||''} ${t.artist||''} ${t.album||''} ${t.collectionName || ''} ${t.relativePath || ''}`.toLowerCase().includes(search.toLowerCase())) : entries.files;
    const [page, setPage] = useState(1);
    const pageSize = 48;
    useEffect(() => setPage(1), [search, tab, collection, path, flat, p.state.activeId]);
    const collectionName = collectionTracks[0]?.collectionName || 'Imported files';
    const folders = useMemo(() => { const map = new Map<string, {
        id: string;
        name: string;
        ids: string[];
    }>(); for (const t of displayTracks) {
        const id = t.collectionId || 'imported-files';
        const group = map.get(id) || { id, name: t.collectionName || 'Imported files', ids: [] };
        group.ids.push(t.id);
        map.set(id, group);
    } const result = [...map.values()]; result.forEach(group => group.ids.sort((a, b) => (trackMap.get(a)?.relativePath || trackMap.get(a)?.name || '').localeCompare(trackMap.get(b)?.relativePath || trackMap.get(b)?.name || '', undefined, { numeric: true }))); return result.sort((a, b) => a.name.localeCompare(b.name)); }, [displayTracks, trackMap]);
    const queueAction = (update: (q: MusicQueue) => MusicQueue) => { if (active)
        p.change({ ...p.state, queues: p.state.queues.map(q => q.id === active.id ? update(q) : q) }); };
    const safe = async (work: () => Promise<void>) => { try {
        await work();
    }
    catch (error) {
        showToast(error instanceof Error ? error.message : 'Unable to update music library', 'error');
    } };
    const savePlaylist = async (playlist: MusicPlaylist) => { await musicWrite('playlists', { ...playlist, trackIds: uniqueMusicIds(playlist.trackIds, p.tracks) }); await p.reload(); };
    const requestSource = (title: string, key: string, ids: string[], shuffled = false) => {
        const unique = uniqueMusicIds(ids, p.tracks);
        if (!unique.length)
            return;
        if (p.state.queues.some(q => q.sourceKey === key))
            setChoice({ name: title, key, ids: unique, shuffled });
        else
            p.source(title, key, unique, 'replace', shuffled);
    };
    const addPlaylist = () => safe(async () => { if (!playlistId) {
        showToast('Choose a playlist first', 'error');
        return;
    } const pl = p.playlists.find(x => x.id === playlistId); if (pl)
        await savePlaylist({ ...pl, trackIds: [...pl.trackIds, ...selected] }); showToast('Selection added without duplicates'); });
    async function importFiles(files: ImportFile[]) {
        if (p.loading || p.error) {
            showToast('Open the local library successfully before importing', 'error');
            return;
        }
        if (importer.current||scanner.current) {
            showToast('An import is already running', 'error');
            return;
        }
        const controller = new AbortController();
        importer.current = controller;
        setImportResult(null);
        let imported = 0, duplicates = 0, skipped = 0;
        try {
            const supported = files.filter(({ file }) => isAudio(file));
            skipped = files.length - supported.length;
            if (!supported.length) {
                showToast('No supported audio files found', 'error');
                return;
            }
            // Backfill old imports before matching new files by content, regardless of folder/name.
            const old = p.tracks.filter(t => !t.contentId);
            for (let i = 0; i < old.length; i++) {
                controller.signal.throwIfAborted();
                setProgress(`Checking existing songs ${i + 1}/${old.length}`);
                const stored = await musicRead<StoredMusicTrack>('tracks', old[i].id);
                if (stored?.blob)
                    await identifyExistingMusic(old[i], await musicContentId(stored.blob, controller.signal));
            }
            const roots = new Map<string, string>();
            for (let i = 0; i < supported.length; i++) {
                controller.signal.throwIfAborted();
                const { file, path: relative } = supported[i];
                setProgress(`Importing ${i + 1}/${supported.length} · ${file.name}`);
                if (!file.size) {
                    skipped++;
                    continue;
                }
                const parts = relative.replace(/\\/g, '/').split('/').filter(Boolean), folder = parts.length > 1 ? parts[0] : 'Imported files';
                let collectionId = roots.get(folder);
                if (!collectionId) {
                    collectionId = parts.length > 1 ? crypto.randomUUID() : 'imported-files';
                    roots.set(folder, collectionId);
                }
                const contentId = await musicContentId(file, controller.signal);
                controller.signal.throwIfAborted();
                if (await insertMusic({ id: crypto.randomUUID(), name: file.name, blob: file, contentId, addedAt: Date.now(), lastModified: file.lastModified, collectionId, collectionName: folder, relativePath: parts.length > 1 ? parts.slice(1).join('/') : file.name }))
                    imported++;
                else
                    duplicates++;
            }
            setImportResult({imported,duplicates,skipped,stopped:false});
            showToast(`${imported} imported · ${duplicates} duplicates skipped · ${skipped} unsupported/empty skipped`);
        }
        catch (error) {
            setImportResult({imported,duplicates,skipped,stopped:true});
            showToast(controller.signal.aborted ? `Import stopped · ${imported} saved; completed songs were kept` : `Import stopped after ${imported} saved: ${error instanceof Error ? error.message : 'Storage unavailable'}`, controller.signal.aborted ? 'info' : 'error');
        }
        finally {
            importer.current = null;
            setProgress('');
            await p.reload();
        }
    }
    const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
        const input=event.currentTarget;
        try {
            if(scanner.current||importer.current||review||choice||removeChoice||p.loading||p.error)return;
            const files=pickedMusicFiles(input.files||[]);if(files.length)setReview(files);
        } catch(error){showToast(error instanceof Error?error.message:'Could not review these files','error');}
        finally{input.value='';}
    };
    const onDrop = (event: React.DragEvent) => {
        event.preventDefault();setDragging(false);
        if(!event.dataTransfer.files.length&&!Array.from(event.dataTransfer.items).some(item=>item.kind==='file'))return;
        if(scanner.current||importer.current||review||choice||removeChoice||p.loading||p.error){showToast('Finish or cancel the current music action before dropping another folder','info');return;}
        const controller=new AbortController();scanner.current=controller;setImportResult(null);setProgress('Scanning dropped folders…');
        // Discovery starts in this event turn so browser drop entries stay valid.
        void droppedMusicFiles(event.dataTransfer,{signal:controller.signal,onProgress:(visited,count)=>{if(alive.current&&!controller.signal.aborted)setProgress(`Scanning folders · ${visited} entries · ${count} files found`);}})
          .then(files=>{if(alive.current&&!controller.signal.aborted){if(files.length)setReview(files);else showToast('No files found in this selection','info');}})
          .catch(error=>{if(alive.current)showToast(controller.signal.aborted?'Folder scan cancelled; no songs were imported':error instanceof Error?error.message:'Could not read this folder','info');})
          .finally(()=>{if(scanner.current===controller)scanner.current=null;if(alive.current)setProgress('');});
    };
    const dragOrder = (source: string, id: string, commit: (ids: string[]) => void, ids: string[]) => ({
        draggable: true,
        onDragStart: (event: React.DragEvent) => { dragged.current = { source, id }; event.dataTransfer.setData('text/plain', id); event.dataTransfer.effectAllowed = 'move'; },
        onDragEnd: () => { dragged.current = null; setDragging(false); },
        onDragOver: (event: React.DragEvent) => { if (dragged.current?.source === source) {
            event.preventDefault();
            event.stopPropagation();
        } },
        onDrop: (event: React.DragEvent) => { if (dragged.current?.source === source) {
            event.preventDefault();
            event.stopPropagation();
            commit(moveMusicId(ids, dragged.current.id, id));
            dragged.current = null;
            setDragging(false);
        } },
    });
    const title=(track:MusicTrack)=>track.title||track.name.replace(/\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|wma|aiff|aif|alac|webm)$/i,'');
    const subtitle=(track:MusicTrack)=>track.artist?[track.artist,track.album].filter(Boolean).join(' · '):track.relativePath?.includes('/')?track.relativePath.split('/').slice(0,-1).join(' / '):track.collectionName||'Local audio';
    const folderResults=folders.filter(folder=>folder.name.toLowerCase().includes(search.toLowerCase())||folder.ids.some(id=>{const track=trackMap.get(id);return track&&`${track.name} ${track.title||''} ${track.artist||''} ${track.album||''}`.toLowerCase().includes(search.toLowerCase());}));
    const queueRows=(active?.trackIds||[]).map((id,index)=>({id,index})).filter(({id})=>{const track=trackMap.get(id);return track&&`${title(track)} ${subtitle(track)} ${track.name}`.toLowerCase().includes(search.toLowerCase());});
    const glyph=(_track:MusicTrack,current=false)=><span className={`music-song-glyph ${current?'is-current':''}`} aria-hidden="true">{current?<Headphones size={15}/>:<Music2 size={15}/>}</span>;
    const row=(track:MusicTrack)=>{
      const current=p.currentId===track.id,checked=selected.includes(track.id);
      return <div key={track.id} className={`music-song-card ${current?'is-current':''} ${checked?'is-selected':''}`}>
        <div className="music-song-row">
          <input className="music-select" type="checkbox" aria-label={`Select ${track.name}`} checked={checked} onChange={event=>setSelected(ids=>event.target.checked?[...ids,track.id]:ids.filter(id=>id!==track.id))}/>
          {glyph(track,current)}
          <button type="button" className="music-song-copy" aria-current={current?'true':undefined} onClick={()=>p.play(track.id)} title={`${title(track)} · ${track.name}`}><strong>{title(track)}</strong><span>{subtitle(track)}</span></button>
          <button type="button" className="music-icon-action" title="Add to queue" aria-label={`Add ${track.name} to queue`} onClick={()=>p.enqueue([track.id],'end')}><Plus size={15}/></button>
          <button type="button" className="music-icon-action" aria-label={`Actions for ${track.name}`} aria-expanded={trackMenu===track.id} onClick={()=>setTrackMenu(trackMenu===track.id?null:track.id)}><MoreHorizontal size={16}/></button>
        </div>
        {trackMenu===track.id&&<div className="music-row-options"><button type="button" onClick={()=>{p.enqueue([track.id],'next');setTrackMenu(null);}}><ListPlus size={13}/> Play next</button><button type="button" onClick={()=>{setSelected(ids=>uniqueMusicIds([...ids,track.id],p.tracks));setTrackMenu(null);}}><Library size={13}/> Add to playlist…</button><button type="button" className="music-danger" onClick={()=>setRemoveChoice(track)}><Trash2 size={13}/> Remove</button></div>}
      </div>;
    };
    const pager=(total:number)=>{const current=musicPage(total,page,pageSize);return total>pageSize&&<nav aria-label="Music pages" className="music-pager"><button type="button" disabled={current.page===1} onClick={()=>setPage(current.page-1)}><ChevronUp size={13}/> Previous</button><span>{current.page} / {current.pages}</span><button type="button" disabled={current.page===current.pages} onClick={()=>setPage(current.page+1)}>Next <ChevronDown size={13}/></button></nav>;};
    const reorderButtons=(ids:string[],index:number,commit:(ids:string[])=>void,label:string)=><span className="music-reorder-actions">{([-1,1] as const).map(delta=><button key={delta} type="button" className="music-icon-action" aria-label={`Move ${label} ${delta<0?'up':'down'}`} disabled={index+delta<0||index+delta>=ids.length} onClick={()=>{const next=[...ids];[next[index],next[index+delta]]=[next[index+delta],next[index]];commit(next);}}>{delta<0?<ChevronUp size={13}/>:<ChevronDown size={13}/>}</button>)}</span>;
    const empty=(icon:React.ReactNode,heading:string,detail:string)=><div className="music-empty"><span>{icon}</span><strong>{heading}</strong><p>{detail}</p></div>;
    return <div onKeyDown={event=>{if(event.key==='Escape'&&(review||choice||removeChoice)){event.preventDefault();event.stopPropagation();setReview(null);setChoice(null);setRemoveChoice(null);}}} className={`music-library-browser ${dragging?'is-file-dragging':''}`}
      onDragOver={event=>{if(Array.from(event.dataTransfer.types).includes('Files')){event.preventDefault();setDragging(true);}}}
      onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDragging(false);}} onDrop={onDrop}>
      <div className="music-library-heading"><div><strong>{tab==='queues'?'Your queues':tab==='playlists'?'Your playlists':'Your library'}</strong><span>{tab==='queues'?`${p.state.queues.length} saved queues`:tab==='playlists'?`${p.playlists.length} playlists`:`${displayTracks.length} songs · ${folders.length} ${folders.length===1?'collection':'collections'}`}</span></div><span className="music-heading-tools">{(tab==='folders'||tab==='songs')&&p.tracks.length>0&&<button type="button" className="music-import-toggle" aria-label="Import music" aria-expanded={importOpen||!p.tracks.length} aria-controls="music-import-actions" onClick={()=>setImportOpen(value=>!value)}><Upload size={13}/><span>Import</span><ChevronDown size={11}/></button>}<span className="music-local-badge" title="Your music is stored on this device"><ShieldCheck size={11}/> Local</span>{tab==='queues'&&<button type="button" className="music-icon-action" aria-label="New queue" aria-expanded={newQueueOpen} onClick={()=>setNewQueueOpen(value=>!value)}><Plus size={16}/></button>}{tab==='playlists'&&<button type="button" className="music-icon-action" aria-label="New playlist" aria-expanded={newPlaylistOpen} onClick={()=>setNewPlaylistOpen(value=>!value)}><Plus size={16}/></button>}</span></div>
      {(tab==='folders'||tab==='songs')&&(importOpen||!p.tracks.length)&&<div id="music-import-actions" className="music-import-actions">
        <button type="button" onClick={()=>filesInput.current?.click()} disabled={!!progress||!!review||!!choice||!!removeChoice||p.loading||p.error}><Upload size={14}/><span>Import files</span></button>
        <button type="button" onClick={()=>folderInput.current?.click()} disabled={!!progress||!!review||!!choice||!!removeChoice||p.loading||p.error}><FolderOpen size={14}/><span>Import folder</span></button>
      </div>}
      <input ref={filesInput} aria-label="Import audio files" type="file" accept="audio/*,.flac,.opus,.m4a,.wma,.aiff" multiple hidden disabled={!!progress||!!review||!!choice||!!removeChoice||p.loading||p.error} onChange={pick}/>
      <input ref={folderInput} aria-label="Import music folder" type="file" multiple hidden disabled={!!progress||!!review||!!choice||!!removeChoice||p.loading||p.error} {...({webkitdirectory:'',directory:''} as object)} onChange={pick}/>
      <nav className="music-library-nav" aria-label="Music library">
        <button type="button" onClick={p.onNowPlaying} aria-label="Now playing"><Headphones size={15}/><span>Player</span></button>
        {([['folders',FolderOpen,'Folders'],['songs',Music2,'Songs'],['queues',ListMusic,'Queues'],['playlists',Library,'Playlists']] as const).map(([id,Icon,label])=><button key={id} type="button" aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}><Icon size={15}/><span>{label}</span></button>)}
      </nav>
      <div className="music-library-search"><Search size={14}/><input aria-label="Search music" placeholder={tab==='queues'?'Search this queue…':`Search ${tab}…`} value={search} onChange={event=>setSearch(event.target.value)}/>{search&&<button type="button" onClick={()=>setSearch('')} aria-label="Clear music search"><X size={13}/></button>}</div>
      {active&&tab!=='queues'&&<button type="button" className="music-active-queue-strip" onClick={()=>setTab('queues')} aria-label={`Open active queue ${active.name}`}><ListMusic size={13}/><span>Queue <strong>{active.name}</strong></span><span>{active.trackIds.length}</span><ChevronRight size={12}/></button>}
      {dragging&&<div className="music-drop-notice"><Upload size={22}/><strong>Drop music here</strong><span>Files and folders · duplicates skipped</span></div>}
      <div ref={contentArea} className="music-library-content">
        {progress&&<div className="music-feedback" role="status"><div className="music-feedback-heading"><Loader2 size={15} className="music-import-spinner"/><strong>{scanner.current?'Scanning folders':'Adding your music'}</strong><button type="button" onClick={()=>{scanner.current?.abort();importer.current?.abort();}}>Cancel</button></div><p>{progress}</p><div className="music-import-progress" role="progressbar" aria-label="Import progress"><span/></div></div>}
        {importResult&&<div className="music-feedback" role="status"><div className="music-feedback-heading"><Check size={15}/><strong>{importResult.stopped?'Import stopped':'Library updated'}</strong><button type="button" aria-label="Dismiss import summary" onClick={()=>setImportResult(null)}><X size={13}/></button></div><div className="music-import-counts"><span><b>{importResult.imported}</b> added</span><span><b>{importResult.duplicates}</b> duplicates skipped</span><span><b>{importResult.skipped}</b> unsupported/empty</span></div>{importResult.stopped&&<p>Completed songs are saved. You can retry without creating duplicates.</p>}</div>}
        {review&&<section role="dialog" aria-label="Review music import" className="music-feedback"><div className="music-feedback-heading"><Upload size={15}/><strong>Ready to import</strong><button type="button" aria-label="Cancel import review" onClick={()=>setReview(null)}><X size={14}/></button></div><p>{review.filter(({file})=>isAudio(file)&&file.size>0).length} audio files · copied onto this device</p><div className="music-review-files">{review.slice(0,8).map((item,index)=><span key={index} title={item.path}>{item.path}</span>)}{review.length>8&&<span>+ {review.length-8} more files</span>}</div><p>Folder structure stays intact. Identical files are skipped; your originals are unchanged.</p><div className="music-toolbar"><button type="button" className="music-primary-action" disabled={!!progress||!review.some(({file})=>isAudio(file)&&file.size>0)} onClick={()=>{const files=review;setReview(null);void importFiles(files);}}>Import music</button><button type="button" className="music-secondary-action" onClick={()=>setReview(null)}>Cancel</button></div></section>}
        {removeChoice&&<section role="dialog" aria-label="Remove music from library" className="music-feedback"><strong>Remove from library?</strong><p>“{title(removeChoice)}” will leave this library and its queues/playlists. Your original file is unchanged.</p><div className="music-toolbar"><button type="button" className="music-secondary-action music-danger" onClick={()=>void safe(async()=>{await p.remove(removeChoice.id);setRemoveChoice(null);})}>Remove</button><button type="button" className="music-secondary-action" onClick={()=>setRemoveChoice(null)}>Keep song</button></div></section>}
        {choice&&<section role="dialog" aria-label="Existing music queue" className="music-feedback"><strong>Continue “{choice.name}”?</strong><p>Resume your saved place, replace the order, or merge songs without duplicates.</p><div className="music-toolbar">{(['resume','replace','merge'] as const).map(mode=><button type="button" key={mode} className={mode==='resume'?'music-primary-action':'music-secondary-action'} onClick={()=>{p.source(choice.name,choice.key,choice.ids,mode,choice.shuffled);setChoice(null);}}>{mode[0].toUpperCase()+mode.slice(1)}</button>)}<button type="button" className="music-icon-action" aria-label="Cancel queue choice" onClick={()=>setChoice(null)}><X size={14}/></button></div></section>}
        {p.loading?empty(<Loader2 size={24}/>,'Opening your library','Your saved music stays on this device.'):p.error?<div className="music-empty"><Music2 size={24}/><strong>Library unavailable</strong><p>We couldn’t open local music storage.</p><button type="button" className="music-secondary-action" onClick={()=>void p.reload()}>Try again</button></div>:<>
          {tab==='folders'&&!collection&&<><div className="music-section-heading"><strong>Collections</strong><span>{folderResults.length}</span></div>{folderResults.map(folder=><div key={folder.id} className="music-collection-card"><span className="music-collection-glyph"><FolderOpen size={20}/></span><button type="button" className="music-song-copy" onClick={()=>{setCollection(folder.id);setPath('');}}><strong>{folder.name}</strong><span>{folder.ids.length} {folder.ids.length===1?'song':'songs'}</span></button><button type="button" className="music-icon-action" aria-label={`Play ${folder.name}`} onClick={()=>requestSource(folder.name,`folder:${folder.id}`,folder.ids)}><Play size={14}/></button><button type="button" className="music-icon-action" aria-label={`Add ${folder.name} to queue`} onClick={()=>p.enqueue(folder.ids,'end')}><Plus size={15}/></button></div>)}{!folderResults.length&&p.tracks.length>0&&empty(<Search size={22}/>,'No matching collections','Try a folder, song or artist name.')}</>}
          {tab==='folders'&&collection&&<><nav aria-label="Music folder path" className="music-breadcrumbs"><button type="button" aria-label="Back to collections" onClick={()=>{setCollection(null);setPath('');}}><ArrowLeft size={13}/></button><button type="button" onClick={()=>setPath('')}>{collectionName}</button>{path.split('/').filter(Boolean).map((part,index)=><span key={index}><ChevronRight size={11}/><button type="button" onClick={()=>setPath(path.split('/').slice(0,index+1).join('/'))}>{part}</button></span>)}</nav><div className="music-toolbar"><button type="button" className="music-primary-action" onClick={()=>requestSource(path||collectionName,`folder:${collection}:${path}`,collectionTracks.filter(track=>(track.relativePath||track.name).startsWith(path?`${path}/`:'')).map(track=>track.id))}><Play size={12}/> Play folder</button><button type="button" className="music-secondary-action" onClick={()=>requestSource(path||collectionName,`folder:${collection}:${path}`,collectionTracks.filter(track=>(track.relativePath||track.name).startsWith(path?`${path}/`:'')).map(track=>track.id),true)}>Shuffle</button><button type="button" className="music-icon-action" aria-label="Add folder to queue" title="Add folder to queue" onClick={()=>p.enqueue(collectionTracks.filter(track=>(track.relativePath||track.name).startsWith(path?`${path}/`:'')).map(track=>track.id),'end')}><ListPlus size={16}/></button></div><label className="music-inline-option"><input type="checkbox" checked={flat} onChange={event=>setFlat(event.target.checked)}/> Include nested songs</label>{entries.folders.map(folder=><button key={folder} type="button" className="music-nested-folder" onClick={()=>setPath(folder)}><FolderOpen size={16}/><span>{folder.split('/').pop()}</span><ChevronRight size={13}/></button>)}</>}
          {(tab==='songs'||tab==='folders'&&!!collection)&&<><div className="music-section-heading"><strong>{tab==='songs'?'All songs':'Songs'} <span>{visible.length}</span></strong><button type="button" onClick={()=>setSelected(uniqueMusicIds(visible.map(track=>track.id),p.tracks))}>Select all</button></div><div className="music-song-list">{visible.slice(musicPage(visible.length,page).start,musicPage(visible.length,page).end).map(row)}</div>{pager(visible.length)}{!visible.length&&p.tracks.length>0&&empty(<Search size={22}/>,'No songs here',search?'Try a different search.':'Open a subfolder, or include nested songs.')}</>}
          {tab==='queues'&&<>{newQueueOpen&&<div className="music-input-row"><input aria-label="New queue name" value={name} onChange={event=>setName(event.target.value)} placeholder="Name a new queue…"/><button type="button" className="music-secondary-action" aria-label="Create queue" disabled={!name.trim()} onClick={()=>{const queue:MusicQueue={id:crypto.randomUUID(),name:name.trim(),trackIds:[],currentId:null,position:0,shuffle:false,repeat:'off'};p.change({...p.state,activeId:queue.id,queues:[...p.state.queues,queue]});setName('');setNewQueueOpen(false);}}><Plus size={15}/></button></div>}
            <label className="music-queue-picker"><select aria-label="Active music queue" value={p.state.activeId||''} onChange={event=>p.change({...p.state,activeId:event.target.value})}><option value="" disabled>Choose queue…</option>{p.state.queues.map(queue=><option key={queue.id} value={queue.id}>{queue.name} ({queue.trackIds.length})</option>)}</select></label>
            {active?<><section className="music-queue-summary"><div className="music-toolbar"><button type="button" className="music-primary-action" disabled={!active.trackIds.length} onClick={()=>p.play(active.currentId||active.trackIds[0],active.id)}><Play size={12}/> Resume</button><button type="button" className="music-secondary-action" onClick={()=>void safe(async()=>{await savePlaylist({id:crypto.randomUUID(),name:active.name,trackIds:active.trackIds,createdAt:Date.now()});showToast('Queue saved as playlist');})}><Library size={12}/> Save playlist</button><button type="button" className="music-icon-action" aria-label="Queue options" aria-expanded={queueOptionsOpen} onClick={()=>setQueueOptionsOpen(value=>!value)}><MoreHorizontal size={16}/></button></div>{queueOptionsOpen&&<div className="music-queue-options"><label>Queue name<input key={active.id} aria-label="Rename queue" defaultValue={active.name} onBlur={event=>{if(event.target.value.trim())queueAction(queue=>({...queue,name:event.target.value.trim()}));}}/></label><div className="music-toolbar"><button type="button" className="music-secondary-action" onClick={()=>queueAction(queue=>({...queue,trackIds:[],currentId:null,position:0}))}>Clear songs</button><button type="button" className="music-secondary-action music-danger" onClick={()=>p.change({...p.state,activeId:p.state.queues.find(queue=>queue.id!==active.id)?.id||null,queues:p.state.queues.filter(queue=>queue.id!==active.id)})}>Delete queue</button></div></div>}</section><div className="music-section-heading"><strong>Playback order</strong><span>Drag to reorder</span></div>
              <div className="music-song-list">{queueRows.slice(musicPage(queueRows.length,page).start,musicPage(queueRows.length,page).end).map(({id,index})=>{const track=trackMap.get(id);if(!track)return null;const current=id===active.currentId;return <div key={id} {...dragOrder(`queue:${active.id}`,id,ids=>queueAction(queue=>({...queue,trackIds:ids})),active.trackIds)} className={`music-order-row ${current?'is-current':''}`}><span className="music-drag-handle" title="Drag to reorder" aria-hidden="true"><GripVertical size={14}/></span><span className="music-order-number" aria-hidden="true">{current?<Headphones size={13}/>:index+1}</span><button type="button" className="music-song-copy" aria-current={current?'true':undefined} onClick={()=>p.play(id,active.id)}><strong>{title(track)}</strong><span>{current?(p.isPlaying?'Now playing':'Current song'):subtitle(track)}</span></button>{reorderButtons(active.trackIds,index,ids=>queueAction(queue=>({...queue,trackIds:ids})),'song')}<button type="button" className="music-icon-action" aria-label={`Remove ${track.name} from queue`} onClick={()=>queueAction(queue=>({...queue,trackIds:queue.trackIds.filter(value=>value!==id),currentId:queue.currentId===id?null:queue.currentId,position:queue.currentId===id?0:queue.position}))}><X size={13}/></button></div>;})}</div>{pager(queueRows.length)}{search&&!queueRows.length&&active.trackIds.length>0&&empty(<Search size={22}/>,'No matching songs','Try a title, artist or folder name.')}{!active.trackIds.length&&empty(<ListMusic size={22}/>,'Build your queue','Add songs or a whole folder. Each song appears once.')}</>:empty(<ListMusic size={24}/>,'A queue for every mood','Play a folder or playlist to start one, or name your own.')}
          </>}
          {tab==='playlists'&&<>{newPlaylistOpen&&<div className="music-input-row"><input aria-label="New playlist name" value={name} onChange={event=>setName(event.target.value)} placeholder="Name a new playlist…"/><button type="button" className="music-secondary-action" aria-label="Create playlist" disabled={!name.trim()} onClick={()=>void safe(async()=>{const id=crypto.randomUUID();await savePlaylist({id,name:name.trim(),trackIds:[],createdAt:Date.now()});setPlaylistId(id);setName('');setNewPlaylistOpen(false);})}><Plus size={15}/></button></div>}{p.playlists.filter(playlist=>playlist.name.toLowerCase().includes(search.toLowerCase())).map(playlist=><section key={playlist.id} className="music-playlist-card"><div className="music-playlist-heading"><span className="music-collection-glyph"><Library size={18}/></span><input aria-label={`Rename playlist ${playlist.name}`} defaultValue={playlist.name} onBlur={event=>{if(event.target.value.trim()&&event.target.value.trim()!==playlist.name)void safe(()=>savePlaylist({...playlist,name:event.target.value.trim()}));}}/><button type="button" className="music-icon-action" aria-label={`Delete playlist ${playlist.name}`} onClick={()=>void safe(async()=>{await deleteMusicPlaylist(playlist.id);await p.reload();})}><Trash2 size={13}/></button></div><div className="music-toolbar"><button type="button" className="music-secondary-action" disabled={!playlist.trackIds.length} onClick={()=>requestSource(playlist.name,`playlist:${playlist.id}`,playlist.trackIds)}><Play size={12}/> Play</button><button type="button" className="music-secondary-action" onClick={()=>p.enqueue(playlist.trackIds,'end')}><Plus size={12}/> Queue</button><button type="button" className="music-playlist-count" aria-expanded={playlistId===playlist.id} onClick={()=>{setPlaylistId(playlistId===playlist.id?'':playlist.id);setPage(1);}}>{playlist.trackIds.length} songs <ChevronDown size={12}/></button></div>{playlistId===playlist.id&&<div className="music-playlist-songs">{!playlist.trackIds.length&&<p className="music-help">Select songs from your library, then add them to this playlist.</p>}{playlist.trackIds.slice(musicPage(playlist.trackIds.length,page).start,musicPage(playlist.trackIds.length,page).end).map((id,offset)=>{const index=offset+musicPage(playlist.trackIds.length,page).start,track=trackMap.get(id);if(!track)return null;return <div key={id} {...dragOrder(`playlist:${playlist.id}`,id,ids=>void safe(()=>savePlaylist({...playlist,trackIds:ids})),playlist.trackIds)} className="music-order-row"><span className="music-drag-handle" title="Drag to reorder" aria-hidden="true"><GripVertical size={13}/></span><span className="music-song-copy"><strong>{title(track)}</strong><span>{subtitle(track)}</span></span>{reorderButtons(playlist.trackIds,index,ids=>void safe(()=>savePlaylist({...playlist,trackIds:ids})),'playlist song')}<button type="button" className="music-icon-action" aria-label={`Remove ${track.name} from playlist`} onClick={()=>void safe(()=>savePlaylist({...playlist,trackIds:playlist.trackIds.filter(value=>value!==id)}))}><X size={13}/></button></div>;})}{pager(playlist.trackIds.length)}</div>}</section>)}{!p.playlists.length&&empty(<Library size={24}/>,'Keep your favorites together','Create a playlist here, or build one from a song selection.')}</>}
          {!p.tracks.length&&empty(<Music2 size={26}/>,'Make yourself at home','Import songs or a folder. Music stays on this device.')}
        </>}
      </div>
        {!!selected.length&&<section className="music-selection-bar" aria-label="Selected songs"><div className="music-section-heading"><strong><Check size={13}/> {selected.length} selected</strong><button type="button" className="music-icon-action" aria-label="Clear selection" onClick={()=>setSelected([])}><X size={14}/></button></div><div className="music-toolbar"><button type="button" className="music-primary-action" onClick={()=>requestSource(selectionName.trim()||'Selection','selection',selected)}><Play size={12}/> Play</button><button type="button" className="music-secondary-action" onClick={()=>p.enqueue(selected,'next')}>Play next</button><button type="button" className="music-secondary-action" onClick={()=>p.enqueue(selected,'end')}><Plus size={12}/> Queue</button></div><details className="music-selection-playlists"><summary>Add to playlist</summary><div className="music-input-row"><select aria-label="Playlist for selection" value={playlistId} onChange={event=>setPlaylistId(event.target.value)}><option value="">Choose playlist…</option>{p.playlists.map(pl=><option key={pl.id} value={pl.id}>{pl.name}</option>)}</select><button type="button" className="music-secondary-action" onClick={()=>void addPlaylist()}>Add</button></div><div className="music-input-row"><input aria-label="Playlist name for selected songs" placeholder="New playlist name" value={selectionName} onChange={event=>setSelectionName(event.target.value)}/><button type="button" className="music-secondary-action" disabled={!selectionName.trim()} onClick={()=>void safe(async()=>{const id=crypto.randomUUID();await savePlaylist({id,name:selectionName.trim(),trackIds:selected,createdAt:Date.now()});setPlaylistId(id);setSelectionName('');showToast('Playlist created from selection');})}>Create</button></div></details></section>}
    </div>;
}
export default memo(MusicLibraryBrowser);
