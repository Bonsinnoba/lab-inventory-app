import type {Resource,ResourceManifest} from '../api/resources';
import {folderContents} from './folderNavigation';

/** Navigation metadata only; opening a manifest member still resolves its authorized resource. */
export function folderViewerResources(files:ResourceManifest['files'],directory:string,selected?:Resource):Resource[]{
  const siblings=folderContents(files,directory).files.map(file=>{
    const ext=file.original_filename.split('.').pop()?.toLowerCase()||'';
    const file_type:Resource['file_type']=ext==='pdf'?'pdf':['png','jpg','jpeg','gif','webp','svg'].includes(ext)?'image':['mp4','webm','mov','m4v','mkv'].includes(ext)?'video':['mp3','wav','ogg','m4a'].includes(ext)?'audio':['txt','md','markdown','csv','json','xml','yaml','yml'].includes(ext)?'text':['doc','docx','ppt','pptx','xls','xlsx'].includes(ext)?'document':'other';
    return {id:file.id,name:file.original_filename,original_filename:file.original_filename,kind:file.kind==='link'?'link':'file',file_type,mime_type:file.mime_type,size_bytes:file.size_bytes,relative_path:file.relative_path,created_at:''} as Resource;
  });
  const unique=new Map(siblings.map(item=>[item.id,item]));
  if(selected)unique.set(selected.id,selected);
  return [...unique.values()];
}
