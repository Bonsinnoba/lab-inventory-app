import test from 'node:test';
import assert from 'node:assert/strict';
import {requirePermissionReplacementAuthority as authorize} from './permission-replacement-authority.js';
function fixture({role='admin',active=true,grants=[],previous=[],targetRole='member'}={}){
  const queries=[];
  return {queries,async query(sql,args){queries.push(sql);
    if(sql.includes('FROM users'))return {rows:[{id:'actor',role,is_active:active},{id:'target',role:targetRole,is_active:true}]};
    return {rows:args[0]==='actor'?grants:previous};
  }};
}
test('current disabled actor cannot replace permissions',async()=>{
  await assert.rejects(authorize(fixture({active:false}),'actor','target',[]),e=>e.code==='ACCOUNT_DISABLED');
});
test('demoted actor cannot rely on stale admin request authority',async()=>{
  await assert.rejects(authorize(fixture({role:'member'}),'actor','target',[]),e=>e.code==='PERMISSION_DENIED');
});
test('removing a deny is a permission change, not a free replacement',async()=>{
  const c=fixture({role:'member',grants:[{permission:'users.manage_permissions',effect:'grant'}],previous:[{permission:'finance.view_sensitive',effect:'deny'}]});
  await assert.rejects(authorize(c,'actor','target',[]),e=>e.code==='PERMISSION_ESCALATION_BLOCKED');
});
test('delegated manager can change held permission and retain untouched exceptions',async()=>{
  const old={permission:'finance.view_sensitive',effect:'deny'};
  await authorize(fixture({role:'member',grants:[{permission:'users.manage_permissions',effect:'grant'}],previous:[old]}),'actor','target',[old,{permission:'notes.create',effect:'grant'}]);
});
test('administrator targets stay protected after lock',async()=>{
  await assert.rejects(authorize(fixture({targetRole:'admin'}),'actor','target',[]),e=>e.code==='ADMIN_PERMISSION_OVERRIDES_UNSUPPORTED');
});
test('accounts lock in stable order before override reads',async()=>{
  const c=fixture();await authorize(c,'actor','target',[]);
  assert.match(c.queries[0],/ORDER BY id FOR UPDATE$/);
  assert.match(c.queries[1],/user_permission_overrides.*FOR UPDATE$/);
});
