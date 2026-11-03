import test from 'node:test';
import assert from 'node:assert/strict';
import {workSnapshot,reviewedWork,projectWorkHttpMutation} from './project-work-http.js';
test('reviewed task snapshots normalize UUID and optional dates and ignore joined names',()=>{
 const row={title:'task',description:'',status:'todo',priority:'normal',assignee_id:'ABCDEFABCDEF4ABC8ABCABCDEFABCDEF',due_date:'',requirement_id:null};
 const base=workSnapshot('task',row);assert.equal(base.assignee_id,'abcdefab-cdef-4abc-8abc-abcdefabcdef');assert.equal(base.due_date,null);
 assert.doesNotThrow(()=>reviewedWork('task',base,{...row,due_date:null,assignee_username:'changed'}));
 assert.throws(()=>reviewedWork('task',base,{...row,priority:'high'}),e=>e.status===409);
});
test('missing and partial bases fail closed, including delete/repeat inputs',()=>{
 for(const value of [null,[],{title:'only'}])assert.throws(()=>reviewedWork('experiment',value,{}),e=>e.status===400);
 const base=workSnapshot('experiment',{title:'x'});assert.throws(()=>reviewedWork('experiment',base,{title:'edited'}),e=>e.status===409);
});
test('unsupported handler combinations fail before route execution',()=>{
 for(const args of [['link','repeat'],['task','repeat'],['other','create']])assert.throws(()=>projectWorkHttpMutation(...args));
});
test('nested observation review compares timestamps consistently and protects recorded content',()=>{
 const row={kind:'observation',content:'Measured result',observed_at:new Date('2026-11-01T10:00:00Z'),recorded_by:null};
 const base=workSnapshot('observation',row);
 assert.doesNotThrow(()=>reviewedWork('observation',base,row));
 assert.throws(()=>reviewedWork('observation',base,{...row,content:'Changed'}),e=>e.status===409);
 assert.throws(()=>workSnapshot('observation',{...row,observed_at:'invalid'}),e=>e.status===400);
});
