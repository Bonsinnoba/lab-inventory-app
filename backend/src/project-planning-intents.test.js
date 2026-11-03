import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPlanningQuantity,projectItemSnapshot} from './project-planning-intents.js';
import {workSnapshot,reviewedWork} from './project-work-review.js';
test('planning quantities preserve exact supported fractions and numeric zero only for links',()=>{
 for(const [value,expected] of [[1,'1.000'],['1.001','1.001'],[999999999.999,'999999999.999'],[.1,'0.100']])assert.equal(projectPlanningQuantity(value),expected);
 assert.equal(projectPlanningQuantity(0,true),'0.000');assert.throws(()=>projectPlanningQuantity(0));
 for(const bad of [null,undefined,true,'',NaN,Infinity,-1,.0001,1e9,'1.0005'])assert.throws(()=>projectPlanningQuantity(bad,true),e=>e.status===400);
});
test('item reviewed bases ignore physical stock changes and normalize PostgreSQL decimals',()=>{
 assert.deepEqual(projectItemSnapshot({allocated_quantity:'2.000',notes:'keep',current_quantity:0}),projectItemSnapshot({allocated_quantity:2,notes:'keep',current_quantity:999}));
 for(const bad of [null,{}, {allocated_quantity:1},{allocated_quantity:1,notes:null}])assert.throws(()=>projectItemSnapshot(bad),e=>e.status===400);
});
test('BOM review protects demand and canonical requirement without comparing joined stock',()=>{
 const row={name:'Resistors',part_number:null,required_quantity:1,unit:null,preferred_item_id:null,alternative_item_id:null,notes:'',requirement_id:null};
 const base=workSnapshot('bom',row);
 assert.doesNotThrow(()=>reviewedWork('bom',base,{...row,required_quantity:'1.000',preferred_item_quantity:20}));
 assert.throws(()=>reviewedWork('bom',base,{...row,required_quantity:2}),e=>e.status===409);
 assert.throws(()=>reviewedWork('bom',base,{...row,requirement_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),e=>e.status===409);
});
