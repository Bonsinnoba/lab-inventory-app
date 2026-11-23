import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {personalBuildEnvironment} from '../../scripts/build-personal.mjs';
test('personal defaults preserve the real lab origin in both build layers',()=>{
 const env=personalBuildEnvironment({},{platform:'linux'});assert.equal(env.LABOS_NATIVE_API_BASE,'http://localhost:4010/api');assert.equal(env.VITE_API_BASE_URL,env.LABOS_NATIVE_API_BASE);
});
test('an explicitly configured endpoint remains identical in frontend and native trust',()=>{
 for(const input of [{LABOS_NATIVE_API_BASE:'https://lab.example/api/'},{VITE_API_BASE_URL:'https://lab.example/api/'}]){
  const env=personalBuildEnvironment(input,{platform:'linux'});assert.equal(env.LABOS_NATIVE_API_BASE,'https://lab.example/api');assert.equal(env.VITE_API_BASE_URL,env.LABOS_NATIVE_API_BASE);
 }
});
test('personal builds reject conflicting endpoints and credential-bearing URLs',()=>{
 assert.throws(()=>personalBuildEnvironment({LABOS_NATIVE_API_BASE:'http://localhost:4010/api',VITE_API_BASE_URL:'http://127.0.0.1:4020/api'},{platform:'linux'}),/same complete API base/);
 assert.throws(()=>personalBuildEnvironment({LABOS_NATIVE_API_BASE:'https://owner:secret@lab.example/api'},{platform:'linux'}),/without credentials/);
});
test('personal and Preview keep separate profiles and do not weaken shared security configuration',()=>{
 const config=JSON.parse(readFileSync(new URL('../../src-tauri/tauri.personal.conf.json',import.meta.url),'utf8'));
 assert.equal(config.package.productName,'LabOS V2');assert.equal(config.tauri.bundle.identifier,'com.labos.personal.v2');assert.equal(config.build.beforeBuildCommand,'npm run build');assert.equal(config.tauri.security,undefined);assert.equal(config.tauri.allowlist,undefined);
});
