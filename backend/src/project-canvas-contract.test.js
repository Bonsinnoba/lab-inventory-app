import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasRecord,canvasContextAllowed} from './project-canvas-contract.js';
import {reviewedWork,workSnapshot} from './project-work-review.js';
test('canvas geometry rounds positions and rejects invalid content, overflow and minimum size',()=>{
 const row=canvasRecord({block_type:'text',text_content:'Saved',x:1.6});assert.equal(row.x,2);assert.equal(row.width,320);
 for(const patch of [{width:119},{height:79},{x:Infinity},{x:null},{y:2147483648},{block_type:'unknown'},{text_content:' '}])assert.throws(()=>canvasRecord({...row,...patch}),e=>e.status===400);
 assert.throws(()=>canvasRecord({block_type:'pdf'}),e=>e.status===400);
});
test('canvas visibility includes ancestors and notes while preserving shared unowned resources',()=>{
 const actor={role:'researcher'},base={projectId:null,resources:[{id:'leaf',visibility:'lab'}]};
 assert.equal(canvasContextAllowed(base,'p',actor,new Set()),true);
 const folder={projectId:'p',resources:[{id:'leaf',visibility:'lab'},{id:'folder',visibility:'restricted'}]};
 assert.equal(canvasContextAllowed(folder,'p',actor,new Set(['resource:leaf'])),false);
 assert.equal(canvasContextAllowed(folder,'p',actor,new Set(['resource:folder'])),true);
 const note={projectId:'p',resources:[{id:'leaf',visibility:'lab',note_id:'n',note_project_id:'p',note_visibility:'restricted'}]};
 assert.equal(canvasContextAllowed(note,'p',actor,new Set()),false);assert.equal(canvasContextAllowed(note,'p',actor,new Set(['note:n'])),true);
 assert.equal(canvasContextAllowed({...base,projectId:'other'},'p',{role:'admin'},new Set()),false);
 assert.equal(canvasContextAllowed({projectId:'p'},'p',actor,new Set()),false);
});
test('canonical requirement review normalizes quantity and optional empty dates',()=>{
 const row={name:'Demand',requirement_type:'component',quantity:1,unit:null,required_by:'',preferred_item_id:null,notes:'',status:'required'};
 const base=workSnapshot('requirement',row);assert.equal(base.required_by,null);
 assert.doesNotThrow(()=>reviewedWork('requirement',base,{...row,required_by:null,quantity:'1.000'}));
 assert.throws(()=>reviewedWork('requirement',base,{...row,status:'fulfilled'}),e=>e.status===409);
});
