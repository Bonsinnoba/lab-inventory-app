import test from 'node:test';
import assert from 'node:assert/strict';
import {previewBuildEnvironment,previewNativeBuildEnvironment} from '../../scripts/build-preview.mjs';
test('Preview keeps its approved loopback identity in both build environments',()=>{
 const input=Object.freeze({OTHER:'retained'}),env=previewBuildEnvironment(input);
 assert.equal(env.LABOS_NATIVE_API_BASE,'http://127.0.0.1:4000/api');assert.equal(env.VITE_API_BASE_URL,env.LABOS_NATIVE_API_BASE);assert.equal(env.OTHER,'retained');assert.equal(input.LABOS_NATIVE_API_BASE,undefined);
});
test('explicit lab configuration is shared and canonicalized without reading cached grants',()=>{
 for(const input of [{LABOS_NATIVE_API_BASE:'https://LAB.example/deployment/api/'},{VITE_API_BASE_URL:'https://lab.example/deployment/api/'}]){
  const env=previewBuildEnvironment(input);assert.equal(env.LABOS_NATIVE_API_BASE,'https://lab.example/deployment/api');assert.equal(env.VITE_API_BASE_URL,env.LABOS_NATIVE_API_BASE);
 }
});
test('different aliases, ports and API prefixes cannot silently create a mismatched desktop',()=>{
 for(const frontend of ['http://localhost:4000/api','http://127.0.0.1:4001/api','http://127.0.0.1:4000/other/api'])assert.throws(()=>previewBuildEnvironment({LABOS_NATIVE_API_BASE:'http://127.0.0.1:4000/api',VITE_API_BASE_URL:frontend}),/same complete/);
});
test('unsafe or malformed build origins are rejected before launching a build',()=>{
 for(const url of ['http://lab.example/api','https://user:secret@lab.example/api','https://lab.example/api?token=secret','https://lab.example/api#fragment','file:///api','https://lab.example/elsewhere'])assert.throws(()=>previewBuildEnvironment({LABOS_NATIVE_API_BASE:url}),/Preview/);
});

test('Preview build can use the verified native Perl without changing global or duplicate-case PATH',()=>{
 const input=Object.freeze({LOCALAPPDATA:'C:/Users/fixture/AppData/Local',Path:'existing-tools'});const env=previewNativeBuildEnvironment(input,{platform:'win32',exists:()=>true});assert.ok(env.Path.endsWith(';existing-tools'));assert.ok(env.Path.includes('LabOSBuildTools'));assert.equal(env.PATH,undefined);assert.equal(env.OPENSSL_NO_ASM,'1');assert.equal(input.Path,'existing-tools');
});
test('incomplete native Perl installations and non-Windows builds leave PATH unchanged',()=>{
 for(const options of [{platform:'win32',exists:()=>false},{platform:'linux',exists:()=>true}]){const env=previewNativeBuildEnvironment({PATH:'original',LOCALAPPDATA:'fixture'},options);assert.equal(env.PATH,'original');assert.equal(env.OPENSSL_NO_ASM,undefined);}
});
test('explicit static OpenSSL configuration is retained without substituting another build tool',()=>{
 const env=previewNativeBuildEnvironment({PATH:'original',OPENSSL_DIR:'configured',OPENSSL_STATIC:'1'},{platform:'win32',exists:()=>true});assert.equal(env.PATH,'original');assert.equal(env.OPENSSL_DIR,'configured');assert.equal(env.OPENSSL_STATIC,'1');
});
