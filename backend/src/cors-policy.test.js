import test from 'node:test';import assert from 'node:assert/strict';
import {isAllowedOrigin} from './cors-policy.js';
test('desktop CORS accepts exact supported origins and explicit lab web origins',()=>{
 for(const origin of [undefined,'null','tauri://localhost','http://tauri.localhost','https://tauri.localhost'])assert.equal(isAllowedOrigin(origin),true);
 assert.equal(isAllowedOrigin('https://lab.example',['https://lab.example']),true);
});
test('desktop-looking prefixes never grant other sites CORS access',()=>{
 for(const origin of ['https://tauri.localhost.evil.example','http://tauri.localhost:9000','tauri://untrusted','https://tauri.localhost@evil.example','https://lab.example.evil'])assert.equal(isAllowedOrigin(origin,['https://lab.example']),false);
});
