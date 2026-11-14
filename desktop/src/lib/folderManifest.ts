import type {Resource,ResourceManifest} from '../api/resources';
import {folderLocation} from './folderNavigation';

// A derived view over authorized local rows. No path changes, copies or writes.
export function buildFolderManifest(root:Resource,rows:Resource[]):ResourceManifest{
 if(root.kind!=='folder')throw Error('Resource is not a folder');
 const children=new Map<string,Resource[]>(),ids=new Set<string>();
 for(const row of rows){
  if(ids.has(row.id))throw Error('Folder snapshot contains duplicate resource identities');ids.add(row.id);
  if(row.parent_resource_id){const list=children.get(row.parent_resource_id)||[];list.push(row);children.set(row.parent_resource_id,list);}
 }
 const entries:ResourceManifest['files']=[],visited=new Set<string>([root.id]),paths=new Set<string>();
 function walk(id:string,prefix:string,depth:number){
  if(depth>31)throw Error('Folder nesting exceeds 31 levels');
  const siblings=children.get(id)||[];
  const actual=new Map(siblings.filter(row=>row.kind==='folder').map(row=>[folderLocation(row.relative_path||row.name).toLowerCase(),row.id]));
  for(const row of siblings){
   if(entries.length>=10000)throw Error('This folder exceeds the supported listing size');
   if(depth>=31)throw Error('Folder nesting exceeds 31 levels');
   if(visited.has(row.id))throw Error('Folder ancestry is cyclic');visited.add(row.id);
   const leaf=row.kind==='link'?`link-${row.id}`:row.relative_path||row.original_filename||row.name;
   const local=folderLocation(leaf).toLowerCase();
   const ancestors=local.split('/');ancestors.pop();
   while(ancestors.length){if(actual.has(ancestors.join('/')))throw Error('Folder entries have ambiguous canonical parents; existing files have been preserved');ancestors.pop();}
   const relative=folderLocation([prefix,leaf].filter(Boolean).join('/'));
   if(!relative||relative.length>1024)throw Error('Invalid folder entry path');
   const key=relative.toLowerCase();if(row.kind!=='link'){if(paths.has(key))throw Error('Folder contains ambiguous matching paths; review its resource details');paths.add(key);}
   entries.push({id:row.id,kind:row.kind,relative_path:relative,original_filename:row.original_filename||row.name,size_bytes:row.size_bytes??0,mime_type:row.mime_type||'application/octet-stream'});
   if(row.kind==='folder')walk(row.id,relative,depth+1);
  }
 }
 walk(root.id,'',0);
 const files=new Set(entries.filter(entry=>entry.kind==='file').map(entry=>entry.relative_path.toLowerCase()));
 for(const entry of entries){const parts=entry.relative_path.toLowerCase().split('/');parts.pop();while(parts.length){if(files.has(parts.join('/')))throw Error('A file conflicts with a folder path');parts.pop();}}
 return {folder:root.name,files:entries.sort((a,b)=>a.relative_path.localeCompare(b.relative_path,undefined,{numeric:true}))};
}

// Resolve a virtual path to the deepest actual folder. Uploads and empty-folder
// creation then keep their canonical parent instead of placing every file at root.
export function folderDestination(rootId:string,entries:ResourceManifest['files'],directory:string){
 const path=folderLocation(directory);
 let folderId=rootId,prefix='';
 for(const entry of entries){if(entry.kind!=='folder')continue;const candidate=folderLocation(entry.relative_path);if((path===candidate||path.startsWith(`${candidate}/`))&&candidate.length>prefix.length){folderId=entry.id;prefix=candidate;}}
 return {folderId,relativeDirectory:prefix?path.slice(prefix.length).replace(/^\//,''):path};
}
