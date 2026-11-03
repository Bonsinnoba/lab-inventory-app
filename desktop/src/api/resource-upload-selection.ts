/** Directory entries are supplied by the browser's user-initiated drop. */
export interface SelectedUpload { file:File; path:string }
interface Entry {isFile:boolean;isDirectory:boolean;name:string;file?:(ok:(file:File)=>void,fail:(error:unknown)=>void)=>void;createReader?:()=>{readEntries:(ok:(entries:Entry[])=>void,fail:(error:unknown)=>void)=>void}}
export async function filesFromDrop(data:DataTransfer):Promise<SelectedUpload[]>{
 const result:SelectedUpload[]=[];
 let visited=0;
 async function visit(entry:Entry,prefix=''){
  if(++visited>2000||prefix.split('/').length>32)throw Error('Folder structure is too large or deeply nested. Choose a smaller folder.');
  const path=prefix+entry.name;
  if(entry.isFile&&entry.file){const file=await new Promise<File>((ok,fail)=>entry.file!(ok,fail));result.push({file,path});if(result.length>200)throw Error('Choose at most 200 files per upload.');}
  else if(entry.isDirectory&&entry.createReader){const reader=entry.createReader();for(;;){const batch=await new Promise<Entry[]>((ok,fail)=>reader.readEntries(ok,fail));if(!batch.length)break;for(const child of batch)await visit(child,path+'/');}}
 }
 const entries=Array.from(data.items||[]).filter(item=>item.kind==='file').map(item=>(item as unknown as {webkitGetAsEntry?:()=>Entry|null}).webkitGetAsEntry?.());
 if(entries.length&&entries.every(Boolean)){for(const entry of entries)await visit(entry!);}
 else for(const file of Array.from(data.files))result.push({file,path:file.name});
 if(!result.length)throw Error('No files found. Empty folders cannot be imported.');
 if(result.length>200)throw Error('Choose at most 200 files per upload.');
 return result;
}
export function filesFromPicker(files:FileList|File[]):SelectedUpload[]{
 const selected=Array.from(files).map(file=>({file,path:file.webkitRelativePath||file.name}));
 if(selected.length>200)throw Error('Choose at most 200 files per upload.');return selected;
}
