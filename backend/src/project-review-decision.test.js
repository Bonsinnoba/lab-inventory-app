import test from 'node:test';
import assert from 'node:assert/strict';
import {applyProjectReviewDecision} from './project-review-decision.js';

for(const [decision,note,state,code] of [
  ['invalid','',{},'INVALID_REVIEW_DECISION'],
  ['submit',null,{},'INVALID_REVIEW_NOTE'],
  ['submit','x'.repeat(2001),{},'INVALID_REVIEW_NOTE'],
  ['request_changes',' ',{},'REVIEW_REASON_REQUIRED'],
  ['submit','',{status:'active',review_status:'draft'},'REVIEW_STATE_CONFLICT'],
  ['submit','',{status:'planning',review_status:'submitted'},'REVIEW_STATE_CONFLICT'],
  ['approve','',{status:'planning',review_status:'approved'},'REVIEW_STATE_CONFLICT'],
  ['request_changes','reason',{status:'planning',review_status:'draft'},'REVIEW_STATE_CONFLICT'],
])test(`reject ${decision}/${code} before any SQL`,async()=>{
  let queries=0;
  await assert.rejects(applyProjectReviewDecision({query:async()=>{queries++;throw Error('Unexpected SQL');}},state,{user:{userId:'actor'}},decision,note),e=>e.code===code);
  assert.equal(queries,0);
});

test('decision, event and mandatory audit use the same caller-owned transaction',async()=>{
  const sql=[];const client={query:async(text)=>{
    sql.push(text);return {rows:[{id:'p',status:'active',review_status:'approved'}]};
  }};
  const updated=await applyProjectReviewDecision(client,{id:'p',status:'planning',review_status:'submitted'},{user:{userId:'actor'}},'approve','accepted');
  assert.equal(updated.status,'active');assert.equal(sql.length,3);
  assert.match(sql[0],/UPDATE projects/);assert.match(sql[1],/INSERT INTO project_review_events/);
  assert.match(sql[2],/INSERT INTO audit_log/);assert.ok(sql.every(s=>!s.includes('COMMIT')));
});

for(const state of ['draft','changes_requested'])test(`authorized administrator can approve ${state} without synthetic submission`,async()=>{
  const queries=[];
  const client={query:async(sql,args)=>{queries.push({sql,args});return {rows:[{id:'p',status:'active',review_status:'approved'}]};}};
  const result=await applyProjectReviewDecision(client,{id:'p',status:'planning',review_status:state},{user:{userId:'admin'}},'approve','Reviewed');
  assert.equal(result.status,'active');assert.equal(queries.length,3);
  assert.equal(queries[1].args[2],'approve');
});
