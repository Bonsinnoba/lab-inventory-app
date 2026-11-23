import test from 'node:test';
import assert from 'node:assert/strict';
import {writeAuditLog} from './audit.js';

test('required service audit supports an explicit actor without an HTTP request',async()=>{
 const calls=[];
 await writeAuditLog({actorUserId:'service-actor',action:'AI_SETTINGS_UPDATED',entityType:'ai_settings',metadata:{version:1},required:true,client:{query:async(...args)=>calls.push(args)}});
 assert.equal(calls.length,1);
 const [sql,values]=calls[0];assert.match(sql,/INSERT INTO audit_log/);
 assert.equal(values[0],'service-actor');assert.equal(values[1],'AI_SETTINGS_UPDATED');
 assert.deepEqual(JSON.parse(values[6]),{version:1});assert.deepEqual(values.slice(7),[null,null,null]);
});
test('request auditing retains actor and request metadata',async()=>{
 let values;
 await writeAuditLog({req:{user:{userId:'request-actor'},ip:'127.0.0.1',get:()=> 'fixture-agent',method:'PATCH',originalUrl:'/fixture',requestId:'fixture-request'},action:'UPDATE',entityType:'fixture',required:true,client:{query:async(sql,args)=>{values=args;}}});
 assert.equal(values[0],'request-actor');assert.equal(values[7],'127.0.0.1');assert.equal(values[8],'fixture-agent');
 assert.deepEqual(JSON.parse(values[6]),{request_id:'fixture-request',endpoint:'PATCH /fixture'});
});
test('required service audit still propagates persistence failure',async()=>{
 const failure=Error('fixture audit failure'),old=console.error;console.error=()=>{};
 try{await assert.rejects(writeAuditLog({action:'UPDATE',entityType:'fixture',required:true,client:{query:async()=>{throw failure;}}}),error=>error===failure);}finally{console.error=old;}
});
