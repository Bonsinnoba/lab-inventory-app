import test from 'node:test';
import assert from 'node:assert/strict';
import {currentResourceActor,authorizeResourceMutation} from './resource-sync-actor.js';
const user={userId:'actor',role:'admin',credentialVersion:2};
function client(actor={role:'viewer',is_active:true,credential_version:2},permissions=['resources.delete']){
 const calls=[];return {calls,query:async(sql)=>{calls.push(sql);return{rows:sql.includes('FROM users')?[actor]:permissions.map(permission=>({permission,effect:'grant'}))};}};
}
test('resource writes use the locked current role and granular permissions, not the middleware role',async()=>{
 const db=client(),change={operation:'delete'};
 const actor=await authorizeResourceMutation(db,change,user);assert.equal(actor.role,'viewer');assert.equal(change.__role,'viewer');
 assert.ok(db.calls.every(sql=>sql.includes('FOR SHARE')));
 await assert.rejects(authorizeResourceMutation(db,{operation:'edit_metadata'},user),error=>error.code==='PERMISSION_DENIED');
 await assert.rejects(authorizeResourceMutation(client(undefined,['resources.create']),{operation:'create_copy'},user),error=>error.code==='PERMISSION_DENIED');
});
test('observed disablement and credential changes reject before any permission query',async()=>{
 for(const [actor,code] of [[{role:'admin',is_active:false,credential_version:2},'ACCOUNT_DISABLED'],[{role:'admin',is_active:true,credential_version:3},'SESSION_REVOKED']]){
  const db=client(actor);await assert.rejects(currentResourceActor(db,user),error=>error.code===code);assert.equal(db.calls.length,1);
 }
});
