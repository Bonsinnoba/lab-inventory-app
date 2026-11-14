import {spawnSync} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

function normalizeApiBase(raw){
 let url;try{url=new URL(raw);}catch{throw Error('Invalid Preview API URL');}
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(!['http:','https:'].includes(url.protocol)||(url.protocol==='http:'&&!local)||url.username||url.password||url.search||url.hash||!url.pathname.replace(/\/+$/,'').endsWith('/api'))throw Error('Preview requires an HTTPS or loopback-only API URL without credentials');
 return url.href.replace(/\/+$/,'');
}
// This is an explicit build configuration, never a trust decision inferred from
// mutable cached rows. Keep Preview's existing approved loopback identity.
export function previewBuildEnvironment(input){
 const native=normalizeApiBase(input.LABOS_NATIVE_API_BASE||input.VITE_API_BASE_URL||'http://127.0.0.1:4000/api');
 const frontend=normalizeApiBase(input.VITE_API_BASE_URL||native);
 if(native!==frontend)throw Error('Preview frontend and native API must use the same complete API base');
 return {...input,LABOS_NATIVE_API_BASE:native,VITE_API_BASE_URL:frontend};
}

// Build-only discovery of the native Perl already verified for this workspace.
// Runtime/installer code never depends on this optional local tool directory.
export function previewNativeBuildEnvironment(input,{platform=process.platform,exists=existsSync}={}){
 const env=previewBuildEnvironment(input);if(platform!=='win32'||env.OPENSSL_DIR)return env;
 const pinned='6619fe7eeef921ccddb4aac3972fb602a0c690a3074205b863ade998d7bc79a6';
 const home=env.LABOS_BUILD_PERL_HOME||(env.LOCALAPPDATA?join(env.LOCALAPPDATA,'LabOSBuildTools','perl',pinned):null);
 if(home&&exists(join(home,'perl','bin','perl.exe'))&&exists(join(home,'perl','lib','Locale','Maketext','Simple.pm'))){
  const pathKey=Object.keys(env).find(key=>key.toUpperCase()==='PATH')||'PATH';
  env[pathKey]=[join(home,'perl','bin'),join(home,'c','bin'),env[pathKey]||''].join(';');env.OPENSSL_NO_ASM??='1';
 }
 return env;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 const result=spawnSync(process.execPath,[resolve(root,'node_modules/@tauri-apps/cli/tauri.js'),'build','--config','src-tauri/tauri.preview.conf.json','--features','working-encryption',...process.argv.slice(2)],{cwd:root,env:previewNativeBuildEnvironment(process.env),stdio:'inherit',windowsHide:true});
 if(result.error)throw result.error;
 process.exitCode=result.status??1;
}
