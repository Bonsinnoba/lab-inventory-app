import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requireProjectReviewAuthority} from './project-review-authority.js';

function fixture({role='researcher',active=true,overrides=[],member=null,grant=null}={}) {
  const queries=[];
  return {queries,async query(sql){
    queries.push(sql);
    if(sql.includes('FROM users'))return {rows:[{role,is_active:active}]};
    if(sql.includes('user_permission_overrides'))return {rows:overrides};
    if(sql.includes('project_members'))return {rows:member?[{member_role:member}]:[]};
    if(sql.includes('record_access_grants'))return {rows:grant?[{access_level:grant}]:[]};
    throw Error('Unexpected SQL');
  }};
}
const project={id:'project',owner_id:'actor',visibility:'lab'};
const user={userId:'actor',role:'admin'};
test('permission replacement locks the account before changing any overrides',()=>{
  const source=readFileSync(new URL('./routes/auth.js',import.meta.url),'utf8');
  const route=source.slice(source.indexOf("router.put('/users/:id/permissions'"));
  const begin=route.indexOf("await client.query('BEGIN')");
  const lock=route.indexOf('await requirePermissionReplacementAuthority(client,req.user.userId,req.params.id,entries)');
  const remove=route.indexOf('DELETE FROM user_permission_overrides');
  const insert=route.indexOf('INSERT INTO user_permission_overrides');
  assert.ok(begin>=0&&lock>begin&&remove>lock&&insert>remove);
});
for(const [name,options,decision,p] of [
  ['disabled admin',{role:'admin',active:false},'approve',project],
  ['demoted admin',{role:'researcher'},'approve',project],
  ['permission denial',{overrides:[{permission:'projects.edit',effect:'deny'}]},'submit',project],
  ['viewer even with grant',{role:'viewer',overrides:[{permission:'projects.edit',effect:'grant'}]},'submit',project],
  ['restricted owner without edit grant',{},'submit',{...project,visibility:'restricted'}],
  ['ordinary member is not lead',{member:'member'},'submit',{...project,owner_id:'someone-else'}],
])test(`review authority rejects ${name}`,async()=>{
  await assert.rejects(requireProjectReviewAuthority(fixture(options),p,user,decision),e=>e.code==='REVIEW_AUTHORITY_DENIED');
});
test('permission overrides use the caller transaction and locked reads',async()=>{
  const c=fixture();const permissions=await requireProjectReviewAuthority(c,project,user,'submit');
  assert.ok(permissions.has('projects.edit'));
  assert.ok(c.queries.some(q=>q.includes('user_permission_overrides')));
  assert.ok(c.queries.every(q=>q.endsWith('FOR SHARE')));
});
test('current administrator may approve regardless of stale request role',async()=>{
  const permissions=await requireProjectReviewAuthority(fixture({role:'admin'}),project,{...user,role:'viewer'},'approve');
  assert.ok(permissions.has('projects.edit'));
});
test('restricted project lead with explicit edit grant may submit',async()=>{
  await requireProjectReviewAuthority(fixture({member:'lead',grant:'edit'}),{...project,owner_id:'someone-else',visibility:'restricted'},user,'submit');
});
