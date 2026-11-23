/** File discovery only: no IndexedDB writes, hashing or playback effects. */
export type MusicImportFile = {file:File;path:string};
export const MUSIC_SCAN_LIMIT = 10_000;
export const MUSIC_SCAN_DEPTH = 64;
type ScanOptions = {signal:AbortSignal;onProgress?:(visited:number,files:number)=>void;maxEntries?:number;maxDepth?:number;yieldTask?:()=>Promise<void>};
export function pickedMusicFiles(files:FileList|readonly File[]):MusicImportFile[] {
  if(files.length>MUSIC_SCAN_LIMIT) throw Error(`Choose at most ${MUSIC_SCAN_LIMIT.toLocaleString()} files at once. Import larger libraries in smaller folders.`);
  return Array.from(files).map(file=>({file,path:file.webkitRelativePath||file.name}));
}
function readCallback<T>(signal:AbortSignal,read:(resolve:(value:T)=>void,reject:(error:unknown)=>void)=>void):Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    let finished=false;
    const finish=(error:unknown,value?:T)=>{if(finished)return;finished=true;signal.removeEventListener('abort',abort);if(error)reject(error);else resolve(value!);};
    const abort=()=>finish(signal.reason||new DOMException('Folder scan cancelled','AbortError'));
    signal.addEventListener('abort',abort,{once:true});
    try {read(value=>finish(null,value),error=>finish(error||Error('Could not read a dropped file.')));} catch(error){finish(error);}
  });
}
export async function droppedMusicFiles(data:DataTransfer,options:ScanOptions):Promise<MusicImportFile[]> {
  const {signal,onProgress}=options,limit=options.maxEntries??MUSIC_SCAN_LIMIT,depthLimit=options.maxDepth??MUSIC_SCAN_DEPTH;
  signal.throwIfAborted();
  if(!Number.isInteger(limit)||limit<1||limit>MUSIC_SCAN_LIMIT||!Number.isInteger(depthLimit)||depthLimit<0||depthLimit>MUSIC_SCAN_DEPTH)throw Error('Invalid folder scan limits.');
  const tooLarge=()=>Error(`This selection exceeds ${limit.toLocaleString()} entries. Import the library in smaller folders; no songs have been imported.`);
  if(data.items.length>limit||data.files.length>limit)throw tooLarge();
  // Capture entries/files synchronously, before the browser releases drop access.
  const entries=Array.from(data.items).map(item=>item.webkitGetAsEntry?.()).filter((e):e is FileSystemEntry=>Boolean(e));
  const fallback=entries.length?[]:Array.from(data.files).map(file=>({file,path:file.webkitRelativePath||file.name}));
  if(!entries.length){signal.throwIfAborted();onProgress?.(fallback.length,fallback.length);return fallback;}
  type Work = {entry:FileSystemEntry;path:string;depth:number};
  const stack:Work[]=entries.reverse().map(entry=>({entry,path:'',depth:0})),result:MusicImportFile[]=[];
  let scheduled=stack.length,visited=0;
  const yieldTask=options.yieldTask??(()=>new Promise<void>(resolve=>setTimeout(resolve,0)));
  onProgress?.(0,0);
  while(stack.length){
    signal.throwIfAborted();const {entry,path,depth}=stack.pop()!;
    if(depth>depthLimit)throw Error(`Folder nesting exceeds ${depthLimit} levels. Choose a smaller subfolder; no songs have been imported.`);
    visited++;
    if(entry.isFile){
      const file=await readCallback<File>(signal,(resolve,reject)=>(entry as FileSystemFileEntry).file(resolve,reject));
      signal.throwIfAborted();result.push({file,path:`${path}${file.name}`});
    } else if(entry.isDirectory){
      const reader=(entry as FileSystemDirectoryEntry).createReader(),children:FileSystemEntry[]=[];
      for(;;){
        const batch=await readCallback<FileSystemEntry[]>(signal,(resolve,reject)=>reader.readEntries(resolve,reject));
        signal.throwIfAborted();if(!batch.length)break;
        scheduled+=batch.length;if(scheduled>limit)throw tooLarge();
        children.push(...batch);
        onProgress?.(visited,result.length);await yieldTask();signal.throwIfAborted();
      }
      for(let i=children.length-1;i>=0;i--)stack.push({entry:children[i],path:`${path}${entry.name}/`,depth:depth+1});
    }
    if(visited%50===0){onProgress?.(visited,result.length);await yieldTask();}
  }
  signal.throwIfAborted();onProgress?.(visited,result.length);return result;
}
