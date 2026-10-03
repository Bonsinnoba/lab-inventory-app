import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleProjectContext} from './context.js';
const id='00000000-0000-4000-8000-000000000001';
const user={userId:'user'};
function fixture(count=0){
 const calls=[];
 const db={query:async(sql,params)=>{
  calls.push({sql,params});
  if(sql.startsWith('SELECT id,name,status,description'))return {rowCount:1,rows:[{id,name:'Example',status:'planning'}]};
  const rows=Array.from({length:count},(_,i)=>({id:String(i),title:'Entry '+i}));
  return {rowCount:rows.length,rows};
 }};
 return {db,calls};
}
test('denies unauthorized context before any data query',async()=>{
 const {db,calls}=fixture();
 assert.equal(await assembleProjectContext(id,user,db,async()=>({access:'none'})),null);
 assert.equal(calls.length,0);
});
test('returns bounded source-labelled sections with exact overflow flags',async()=>{
 const {db,calls}=fixture(61);
 const result=await assembleProjectContext(id,user,db,async()=>({access:'view'}),async(_type,rows)=>rows);
 assert.equal(result.access,'view');
 assert.equal(result.sections.experiments.length,40);
 assert.equal(result.sections.inventory.length,60);
 assert.equal(result.provenance.truncated.inventory,true);
 assert.equal(result.provenance.authority,'central_postgresql');
 assert.equal(result.provenance.consistency,'multi_query_non_atomic');
 assert.equal(calls.length,7);
 assert.ok(calls.every(call=>call.params[0]===id));
});
test('an exactly full section is not incorrectly labelled truncated',async()=>{
 const {db}=fixture(40);
 const result=await assembleProjectContext(id,user,db,async()=>({access:'edit'}),async(_type,rows)=>rows);
 assert.equal(result.provenance.truncated.experiments,false);
 assert.equal(result.provenance.truncated.inventory,false);
});
test('does not return a missing project',async()=>{
 const db={query:async()=>({rowCount:0,rows:[]})};
 assert.equal(await assembleProjectContext(id,user,db,async()=>({access:'edit'})),null);
});

test('context provenance includes stable project-scoped source references',async()=>{
 const {db}=fixture(2);
 const result=await assembleProjectContext(id,user,db,async()=>({access:'view'}),async(_type,rows)=>rows);
 assert.deepEqual(result.provenance.source_refs.experiments,[
  {source_type:'experiments',source_id:'0',project_id:id},
  {source_type:'experiments',source_id:'1',project_id:id}
 ]);
 assert.equal(result.provenance.source_refs.inventory.length,2);
});
