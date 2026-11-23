import {spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {previewNativeBuildEnvironment} from './build-preview.mjs';

// Personal and Preview share trust validation/build-tool discovery, while
// retaining separate installation/profile identities. Never copy Preview data.
export function personalBuildEnvironment(input,options={}){
 const base=input.LABOS_NATIVE_API_BASE||input.VITE_API_BASE_URL||'http://localhost:4010/api';
 return previewNativeBuildEnvironment({...input,LABOS_NATIVE_API_BASE:base,VITE_API_BASE_URL:input.VITE_API_BASE_URL||base},options);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 const result=spawnSync(process.execPath,[resolve(root,'node_modules/@tauri-apps/cli/tauri.js'),'build','--config','src-tauri/tauri.personal.conf.json','--features','working-encryption',...process.argv.slice(2)],{cwd:root,env:personalBuildEnvironment(process.env),stdio:'inherit',windowsHide:true});
 if(result.error)throw result.error;
 process.exitCode=result.status??1;
}
