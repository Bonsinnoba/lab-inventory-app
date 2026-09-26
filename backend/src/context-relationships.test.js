import test from 'node:test';
import assert from 'node:assert/strict';
import {projectContextEdges} from './context-relationships.js';
const projectId='00000000-0000-4000-8000-000000000001';
test('derives only explicit project and reservation foreign-key relationships',()=>{
 const edges=projectContextEdges({scope:{id:projectId},sections:{
  experiments:[{id:'experiment-1'}],tasks:[],inventory:[{item_id:'item-1'}],
  reservations:[{id:'reservation-1',item_id:'item-1'}],notes:[{id:'note-1'}],resources:[]
 }});
 assert.equal(edges.length,5);
 assert.deepEqual(edges.find(e=>e.relation==='reserves_item').from,{type:'reservation',id:'reservation-1'});
 assert.ok(edges.every(e=>e.authority==='central_postgresql'&&e.source));
 assert.ok(edges.every(e=>e.to.id));
});
test('missing context yields no relationships',()=>assert.deepEqual(projectContextEdges(null),[]));
