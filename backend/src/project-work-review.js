import {catalogUuid} from './catalog-sync.js';
import {projectDateValue} from './project-date-value.js';
import {projectPlanningQuantity} from './project-planning-intents.js';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
export const workFields={
 task:['title','description','status','priority','assignee_id','due_date','requirement_id'],
 experiment:['title','status','hypothesis','procedure','observations','result','conclusion','performed_by','requirement_id'],
 measurement:['name','value_numeric','value_text','unit','uncertainty','observed_at','recorded_by','notes'],
 observation:['kind','content','observed_at','recorded_by'],
 bom:['name','part_number','required_quantity','unit','preferred_item_id','alternative_item_id','notes','requirement_id'],
 block:['block_type','text_content','resource_id','title','x','y','width','height'],
 connector:['source_block_id','target_block_id','label'],
 requirement:['name','requirement_type','quantity','unit','required_by','preferred_item_id','notes','status'],
};

export function workSnapshot(kind,row){
 return Object.fromEntries(workFields[kind].map(field=>{
  let value=row[field]??null;
  if(['due_date','required_by'].includes(field))value=projectDateValue(field,value);
  if(['due_date','required_by'].includes(field)&&value instanceof Date)value=value.toISOString().slice(0,10);
  if(field==='observed_at'&&value!=null){if(Number.isNaN(new Date(value).getTime()))fail(400,'PROJECT_WORK_INVALID','Invalid reviewed observation time');value=new Date(value).toISOString();}
  if(field.endsWith('_id')&&value!=null)value=catalogUuid(value);
  if(['required_quantity','quantity'].includes(field))value=projectPlanningQuantity(value);
  return [field,value];
 }));
}
export function reviewedWork(kind,before,current){
 if(!before||typeof before!=='object'||Array.isArray(before)||workFields[kind].some(f=>!Object.hasOwn(before,f)))fail(400,'PROJECT_WORK_BASE_REQUIRED','Supply the complete work record that was reviewed');
 if(JSON.stringify(workSnapshot(kind,before))!==JSON.stringify(workSnapshot(kind,current)))fail(409,'PROJECT_WORK_CHANGED','Work changed; refresh and review before retrying');
}
