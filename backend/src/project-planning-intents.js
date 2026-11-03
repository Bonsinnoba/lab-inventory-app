import {catalogUuid} from './catalog-sync.js';
import {requireProjectWorkAuthority} from './project-work-authority.js';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
// Match NUMERIC(12,3) without letting PostgreSQL silently round authored demand.
export function projectPlanningQuantity(value,allowZero=false){
 if(!['number','string'].includes(typeof value)||String(value).trim()==='')fail(400,'PROJECT_QUANTITY_INVALID','Supply a planning quantity');
 const n=Number(value),scaled=n*1000;
 if(!Number.isFinite(n)||n<0||!allowZero&&n===0||n>=1e9||Math.abs(scaled-Math.round(scaled))>Math.max(1,Math.abs(scaled))*Number.EPSILON*4)fail(400,'PROJECT_QUANTITY_INVALID','Quantity must fit nine whole digits and at most three decimal places');
 return n.toFixed(3);
}
export function projectItemSnapshot(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(value,'allocated_quantity')||!Object.hasOwn(value,'notes'))fail(400,'PROJECT_ITEM_BASE_REQUIRED','Supply the item-link quantity and notes that were reviewed');
 if(typeof value.notes!=='string')fail(400,'PROJECT_ITEM_INVALID','Item-link notes must be text');
 return {allocated_quantity:projectPlanningQuantity(value.allocated_quantity,true),notes:value.notes};
}
export async function applyProjectItemIntent(client,change,user){
 const payload=change.payload||{},record=payload.record||payload.item||payload;
 const projectId=catalogUuid(record.project_id),itemId=catalogUuid(record.item_id);
 const actor=await requireProjectWorkAuthority(client,projectId,user.userId);
 const before=(await client.query('SELECT * FROM project_items WHERE project_id=$1 AND item_id=$2 FOR UPDATE',[projectId,itemId])).rows[0]??null;
 // New native intents and browser writes carry their reviewed base. Legacy
 // immutable events retain compatibility; do not silently rewrite those events.
 if(Object.hasOwn(payload,'expected')){
  const expected=payload.expected===null?null:projectItemSnapshot(payload.expected);
  const current=before?projectItemSnapshot(before):null;
  if(JSON.stringify(expected)!==JSON.stringify(current))fail(409,'PROJECT_ITEM_CHANGED','The project item link changed; refresh and review before retrying');
 }
 if(change.operation==='delete'){
  await client.query('DELETE FROM project_items WHERE project_id=$1 AND item_id=$2',[projectId,itemId]);
  return {before,result:{id:itemId,item_id:itemId,project_id:projectId,deleted:true,already_deleted:!before}};
 }
 if(!['create','upsert'].includes(change.operation))fail(400,'PROJECT_ITEM_INVALID','Unsupported project item operation');
 const data=projectItemSnapshot({allocated_quantity:record.allocated_quantity??0,notes:record.notes??''});
 if(!actor.permissions.has('inventory.view'))fail(403,'INVENTORY_VIEW_REQUIRED','Inventory view permission required');
 if(!(await client.query('SELECT id FROM items WHERE id=$1 FOR KEY SHARE',[itemId])).rowCount)fail(400,'PROJECT_ITEM_INVALID','Inventory item is unavailable');
 let result;
 if(before)result=(await client.query('UPDATE project_items SET allocated_quantity=$1,notes=$2 WHERE project_id=$3 AND item_id=$4 RETURNING *',[data.allocated_quantity,data.notes,projectId,itemId])).rows[0];
 else result=(await client.query('INSERT INTO project_items(project_id,item_id,allocated_quantity,notes,added_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[projectId,itemId,data.allocated_quantity,data.notes,user.userId])).rows[0];
 if(!result)fail(500,'PROJECT_ITEM_CONFIRMATION_MISSING','Database did not confirm the item link');
 return {before,result:{...result,id:itemId}};
}
