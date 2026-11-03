import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./reservation-review-projection.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
const project=exports.projectReservationReview;
const pending={id:'r',item_id:'i',status:'pending_review',quantity:2,needed_from:'2026-10-29T10:00:00Z',needed_until:'2026-10-29T11:00:00Z'};
const confirmed={...pending,id:'c',status:'confirmed',quantity:3};
const item={id:'i',name:'Meter',type:'equipment',current_quantity:10};
test('overlapping reusable allocations count, touching boundaries do not',()=>{
 const data=project([{reservations:[pending,confirmed,{...confirmed,id:'later',needed_from:pending.needed_until}]}],[item]);
 assert.equal(data.items.length,1);assert.equal(data.items[0].overlapping_confirmed,3);
});
test('consumables count confirmed stock across non-overlapping dates',()=>{
 const data=project([{reservations:[pending,{...confirmed,needed_from:'2027-01-01T00:00:00Z'}]}],[{...item,type:'component'}]);
 assert.equal(data.items[0].overlapping_confirmed,3);
});
test('missing inventory remains unknown instead of zero',()=>{
 const row=project([{reservations:[pending]}],[]).items[0];
 assert.equal(row.current_quantity,null);assert.equal(row.overlapping_confirmed,null);
});
test('missing project snapshot is distinguished from an empty one',()=>{
 assert.equal(project([{}, {reservations:[]}],[]).missingProjects,1);
});
test('pending decisions remain visible without changing server status',()=>{
 const row=project([{reservations:[{...pending,local_pending_action:'confirm'}]}],[item]).items[0];
 assert.equal(row.status,'pending_review');assert.equal(row.local_pending_action,'confirm');
});
test('invalid overlap data cannot manufacture availability',()=>{
 const row=project([{reservations:[pending,{...confirmed,quantity:'invalid'}]}],[item]).items[0];
 assert.equal(row.overlapping_confirmed,null);
});
test('null stock and missing required usage dates remain unknown',()=>{
 assert.equal(project([{reservations:[pending]}],[{...item,current_quantity:null}]).items[0].current_quantity,null);
 assert.equal(project([{reservations:[pending,{...confirmed,needed_from:null}]}],[item]).items[0].overlapping_confirmed,null);
});
