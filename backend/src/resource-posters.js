import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {resolveStoragePath} from './storage.js';

const backend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ffmpeg=process.env.FFMPEG_PATH||path.join(backend,'tools','ffmpeg','bin',process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
const pending=new Map(),failed=new Map();
let active=0;
const unavailable=message=>Object.assign(new Error(message),{status:503});
function extract(input,output,seek){
  return new Promise((resolve,reject)=>{
    // Uploaded containers must not resolve network protocols or spawn a shell.
    const args=['-hide_banner','-loglevel','error','-nostdin','-y','-threads','2','-filter_threads','1',
      '-protocol_whitelist','file','-format_whitelist','mov,matroska,avi,mpegts,mpeg,mpegvideo,ogg,asf,flv','-ss',String(seek),'-i',input,'-an','-sn','-dn',
      '-vf','thumbnail=30,scale=640:360:force_original_aspect_ratio=decrease','-frames:v','1','-q:v','3',output];
    const child=spawn(ffmpeg,args,{windowsHide:true,stdio:['ignore','ignore','ignore']});
    const timeout=setTimeout(()=>{child.kill('SIGKILL');},20000);
    child.once('error',error=>{clearTimeout(timeout);reject(error);});
    child.once('close',code=>{clearTimeout(timeout);code===0?resolve():reject(unavailable('Video preview extraction failed'));});
  });
}
export async function ensureResourcePoster(resource){
  const source=resource.kind==='file'&&resource.file_type==='video'?resource.storage_path:resource.local_media_path;
  if(!source)throw Object.assign(new Error('No video file available'),{status:404});
  if(!/^[0-9a-f-]{36}$/i.test(resource.id))throw new Error('Invalid resource ID');
  const input=resolveStoragePath(source),stat=await fs.stat(input);
  const revision=createHash('sha256').update(JSON.stringify([source,stat.size,stat.mtimeMs])).digest('hex');
  const dir=resolveStoragePath(`${resource.id}/.previews`),target=path.join(dir,revision+'.jpg');
  if(await fs.stat(target).then(s=>s.isFile()&&s.size>0&&s.size<=1048576).catch(()=>false))return target;
  if(pending.has(target))return pending.get(target);
  if((failed.get(target)||0)>Date.now())throw unavailable('Video preview temporarily unavailable');
  if(active>=2)throw unavailable('Video preview service is busy; retry later');
  const task=(async()=>{
    active++;let temp;
    try{
      await fs.mkdir(dir,{recursive:true});temp=path.join(dir,randomUUID()+'.jpg');
      await extract(input,temp,0.5);
      if(!await fs.stat(temp).then(s=>s.size>0).catch(()=>false))await extract(input,temp,0);
      const bytes=await fs.readFile(temp);
      if(bytes.length<4||bytes.length>1048576||bytes[0]!==255||bytes[1]!==216)throw unavailable('No usable video preview');
      const after=await fs.stat(input);
      if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw unavailable('Video changed during preview extraction');
      await fs.rename(temp,target);failed.delete(target);return target;
    }catch(error){if(failed.size>512)failed.clear();failed.set(target,Date.now()+30000);throw error;}
    finally{active--;pending.delete(target);if(temp)await fs.unlink(temp).catch(()=>{});}
  })();pending.set(target,task);return task;
}
export async function prepareResourcePoster(resource){
  if(resource.file_type!=='video')return;
  try{await ensureResourcePoster(resource);}catch{/* Upload remains successful; protected reads can retry later. */}
}
