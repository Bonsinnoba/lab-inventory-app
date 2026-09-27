import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEvidenceQuery,evidenceLimit,evidenceResult} from './context-evidence.js';
import {searchProjectEvidence} from './routes/context.js';
const id='00000000-0000-4000-8000-000000000001';
test('normalizes and bounds evidence queries',()=>{
 assert.equal(normalizeEvidenceQuery('  calibration   drift '),'calibration drift');
 assert.throws(()=>normalizeEvidenceQuery('x'),RangeError);
 assert.throws(()=>normalizeEvidenceQuery('x'.repeat(161)),RangeError);
 assert.equal(evidenceLimit(500),25);
 assert.equal(evidenceLimit(-2),10);
});
test('evidence includes typed source refs and bounded excerpts',()=>{
 const row=evidenceResult('note',{id:'n1',title:'Calibration',updated_at:'2026-01-01',excerpt:'Observed drift'});
 assert.equal(row.ref.type,'note');assert.equal(row.source.record_id,'n1');assert.equal(row.match,'lexical');
});
test('denies inaccessible project before any evidence query',async()=>{
 let calls=0;
 const result=await searchProjectEvidence(id,{userId:'u'},'calibration',10,{query:async()=>{calls++;return {rows:[]};}},async()=>({access:'none'}));
 assert.equal(result,null);assert.equal(calls,0);
});
test('scopes both evidence queries to project and caps returned results',async()=>{
 const calls=[];
 const db={query:async(sql,params)=>{calls.push({sql,params});return {rows:Array.from({length:3},(_,i)=>({id:String(i),title:'Note '+i,name:'Resource '+i,updated_at:'2026-01-01',excerpt:'match'}))};}};
 const result=await searchProjectEvidence(id,{userId:'u'},'drift',2,db,async()=>({access:'view'}));
 assert.equal(calls.length,2);
 assert.ok(calls.every(c=>c.sql.includes('project_id=$1')&&c.params[0]===id&&c.params[2]===3));
 assert.equal(result.results.length,2);assert.equal(result.truncated,true);
 assert.ok(result.results.every(x=>x.source.record_id&&x.ref.type));
});
