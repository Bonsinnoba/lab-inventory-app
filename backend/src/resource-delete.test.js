import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourceDeleter} from './resource-delete.js';
const resource={id:'resource',kind:'folder',project_id:null};
test('nonempty folder deletion refuses before changing children, grants, tombstones or audit',async()=>{
 const calls=[],remove=createResourceDeleter({authorize:async()=>({ok:true}),audit:async()=>{throw Error('Unexpected audit');}});
 const db={query:async(sql)=>{calls.push(sql);return sql.startsWith('SELECT *')?{rows:[resource]}:{rows:[{}],rowCount:1};}};
 await assert.rejects(remove(db,resource.id,{userId:'actor'}),error=>error.code==='RESOURCE_FOLDER_NOT_EMPTY');
 assert.ok(calls.every(sql=>sql.startsWith('SELECT')));assert.match(calls[0],/FOR UPDATE/);
});
test('resource deletion requires the same transaction audit and retains the original snapshot',async()=>{
 let audited=false;const db={query:async(sql)=>sql.startsWith('SELECT *')?{rows:[resource]}:{rows:[],rowCount:0}};
 const remove=createResourceDeleter({authorize:async()=>({ok:true,context:{projectId:'inherited-project'}}),audit:async args=>{
  audited=true;assert.equal(args.client,db);assert.equal(args.required,true);assert.equal(args.oldValue,resource);assert.equal(args.metadata.project_id,'inherited-project');throw Error('Required audit unavailable');
 }});
 await assert.rejects(remove(db,resource.id,{userId:'actor'}),/Required audit unavailable/);assert.equal(audited,true);
});
