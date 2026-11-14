import type {Resource} from '../api/resources';

export type ResourceFilters={search:string;type:string;project:string;attachment:string;availability:string};
export const emptyResourceFilters:ResourceFilters={search:'',type:'all',project:'all',attachment:'all',availability:'all'};
export function hasResourceFilters(filters:ResourceFilters){return filters.search.trim()!==''||['type','project','attachment','availability'].some(key=>filters[key as keyof ResourceFilters]!=='all');}

// Filtering reads already-authorized records; it never fetches missing parents
// or changes grants. An unresolved/cyclic ancestry cannot match a project.
export function filterResources(rows:Resource[],notes:Array<{id:string;project_id?:string|null}>,filters:ResourceFilters):Resource[]{
 const resources=new Map(rows.map(row=>[row.id,row])),noteProjects=new Map(notes.map(note=>[note.id,note.project_id]));
 function context(row:Resource){
  const seen=new Set<string>();let current:Resource|undefined=row,project:string|null=null,attachment='unattached';
  while(current){
   if(seen.size>=32||seen.has(current.id))return null;seen.add(current.id);
   if(current.project_id){if(project&&project!==current.project_id)return null;project=current.project_id;attachment='project';}
   if(current.note_id){attachment='note';const noteProject=noteProjects.get(current.note_id);if(noteProject){if(project&&project!==noteProject)return null;project=noteProject;}}
   if(current.item_id)attachment='item';
   if(!current.parent_resource_id)return{project,attachment};current=resources.get(current.parent_resource_id);if(!current)return null;
  }return null;
 }
 const query=filters.search.trim().toLocaleLowerCase(),active=hasResourceFilters(filters);
 return rows.filter(row=>{
  if(!active)return !row.parent_resource_id;
  if(query&&![row.name,row.original_filename,row.description,row.url,row.relative_path,...(row.tags||[])].some(value=>value?.toLocaleLowerCase().includes(query)))return false;
  if(filters.type!=='all'){
   const isVideo=row.file_type==='video'||row.file_type==='youtube'||row.mime_type?.startsWith('video/')||row.local_media_mime_type?.startsWith('video/');
   if(['file','folder','link'].includes(filters.type)?row.kind!==filters.type:filters.type==='video'?!isVideo:row.file_type!==filters.type)return false;
  }
  if(filters.project!=='all'||filters.attachment!=='all'){
   const resolved=context(row);if(!resolved)return false;
   if(filters.project==='unattached'?resolved.attachment!=='unattached':filters.project!=='all'&&resolved.project!==filters.project)return false;
   if(filters.attachment!=='all'&&resolved.attachment!==filters.attachment)return false;
  }
  // Server completion metadata is not proof of a current readable PC file.
  if(filters.availability==='local'&&row.local_file_available!==true)return false;
  return true;
 });
}
