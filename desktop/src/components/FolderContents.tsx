import {ChevronRight,Folder,File,ArrowUp} from 'lucide-react';
import type {ResourceManifest} from '../api/resources';
import {folderContents} from '../lib/folderNavigation';
import {useMemo,useRef,useState} from 'react';
import {resourcePage} from '../lib/resourcePage';
type FolderRow={kind:'directory';name:string}|{kind:'file';file:ResourceManifest['files'][number]};
export default function FolderContents({files,directory,onNavigate,onOpen,opening,disabled=false}:{files:ResourceManifest['files'];directory:string;onNavigate:(path:string)=>void;onOpen:(id:string)=>void;opening:string|null;disabled?:boolean}){
 const contents=useMemo(()=>folderContents(files,directory),[files,directory]),parts=directory?directory.split('/'):[];
 const rows=useMemo(()=>contents.directories.map<FolderRow>(name=>({kind:'directory',name})).concat(contents.files.map<FolderRow>(file=>({kind:'file',file}))),[contents]);
 const [position,setPosition]=useState({directory,index:0});
 const page=resourcePage(rows,position.directory===directory?position.index:0);
 const top=useRef<HTMLDivElement>(null);
 const changePage=(index:number)=>{setPosition({directory,index});top.current?.scrollIntoView({block:'start'});};
 return <div className="space-y-3">
  <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-xs"><button type="button" disabled={disabled} onClick={()=>onNavigate('')} className="rounded px-2 py-1 text-accent hover:bg-surface-raised">Root</button>{parts.map((part,index)=><span key={index} className="flex min-w-0 items-center gap-1"><ChevronRight size={12}/><button type="button" disabled={disabled} onClick={()=>onNavigate(parts.slice(0,index+1).join('/'))} className="max-w-48 truncate rounded px-2 py-1 hover:bg-surface-raised">{part}</button></span>)}</nav>
  {directory&&<button type="button" disabled={disabled} onClick={()=>onNavigate(parts.slice(0,-1).join('/'))} className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-surface-raised"><ArrowUp size={15}/>Up one folder</button>}
  <div ref={top} className="space-y-1">{page.rows.map(row=>row.kind==='directory'?<button type="button" key={`dir:${row.name}`} disabled={disabled} onClick={()=>onNavigate(directory?`${directory}/${row.name}`:row.name)} className="flex w-full items-center gap-3 rounded border border-border px-3 py-2 text-left text-sm hover:border-accent"><Folder size={16}/><span className="min-w-0 flex-1 truncate">{row.name}</span><ChevronRight size={14}/></button>:<button type="button" key={row.file.id} disabled={disabled||!!opening} onClick={()=>onOpen(row.file.id)} title={row.file.relative_path} className="flex w-full items-center gap-3 rounded border border-border px-3 py-2 text-left text-sm hover:border-accent disabled:opacity-50"><File size={16}/><span className="min-w-0 flex-1 truncate">{row.file.original_filename}</span><span className="shrink-0 text-xs text-text-secondary">{opening===row.file.id?'Opening…':row.file.size_bytes<1024?`${row.file.size_bytes} B`:`${(row.file.size_bytes/1024/1024).toFixed(1)} MB`}</span></button>)}
  </div>
  {rows.length>48&&<nav aria-label="Folder pages" className="flex flex-wrap items-center justify-between gap-2 text-xs"><span role="status">{page.start+1}–{page.start+page.rows.length} of {rows.length} entries</span><div className="flex gap-2"><button type="button" disabled={disabled||!!opening||page.index===0} onClick={()=>changePage(page.index-1)} className="rounded border border-border px-2 py-1 disabled:opacity-40">Previous page</button><button type="button" disabled={disabled||!!opening||page.index+1>=page.pages} onClick={()=>changePage(page.index+1)} className="rounded border border-border px-2 py-1 disabled:opacity-40">Next page</button></div></nav>}
  {!contents.files.length&&!contents.directories.length&&<p className="py-6 text-center text-sm text-text-secondary">This folder is empty.</p>}
 </div>;
}
