import {createHash} from 'node:crypto';
import {catalogUuid} from './catalog-sync.js';
const fail=message=>{throw Object.assign(new Error(message),{status:400,code:'INVALID_ASSISTANT_PROPOSAL'});};
function object(value,keys){if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(key=>!keys.includes(key)))fail('Proposal contains unsupported fields');return value;}
function text(value,max,required=false){if(typeof value!=='string'||/[\uD800-\uDFFF]/u.test(value)||value.length>max||required&&!value.trim())fail('Invalid proposal text');return value.trim();}
function date(value){if(value===null||value===undefined||value==='')return null;if(typeof value!=='string'||(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000-'))||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail('Invalid proposal date');return value;}
function priority(value='normal'){if(!['low','normal','high','critical'].includes(value))fail('Invalid proposal priority');return value;}
function list(value,max){if(!Array.isArray(value)||value.length>max)fail('Proposal exceeds its work limits');return value;}
export function validateProposalGraph(value){
 object(value,['schema_version','target','tasks','experiments','links']);if(value.schema_version!==1)fail('Unsupported proposal schema');
 const target=object(value.target,['mode','project_id','name','description','priority','expected_lifecycle_revision']);
 if(!['new','existing'].includes(target.mode))fail('Invalid proposal target');
 const projectId=catalogUuid(target.project_id),ids=new Set([projectId]);
 const unique=id=>{id=catalogUuid(id);if(ids.has(id))fail('Proposal identifiers must be unique');ids.add(id);return id;};
 let normalized;
 if(target.mode==='new'){
  if(Object.hasOwn(target,'expected_lifecycle_revision'))fail('New project cannot carry existing authority');
  normalized={mode:'new',project_id:projectId,name:text(target.name,200,true),description:text(target.description??'',12000),priority:priority(target.priority)};
 }else{
  if(['name','description','priority'].some(field=>Object.hasOwn(target,field))||!Number.isSafeInteger(target.expected_lifecycle_revision)||target.expected_lifecycle_revision<1)fail('Review the existing project lifecycle before proposing work');
  normalized={mode:'existing',project_id:projectId,expected_lifecycle_revision:target.expected_lifecycle_revision};
 }
 const tasks=list(value.tasks,40).map(row=>{object(row,['id','title','description','priority','due_date']);return{id:unique(row.id),title:text(row.title,200,true),description:text(row.description??'',12000),priority:priority(row.priority),due_date:date(row.due_date)};});
 const experiments=list(value.experiments,20).map(row=>{object(row,['id','title','hypothesis','procedure']);return{id:unique(row.id),title:text(row.title,200,true),hypothesis:text(row.hypothesis??'',12000),procedure:text(row.procedure??'',12000)};});
 if(target.mode==='existing'&&!tasks.length&&!experiments.length)fail('Existing-project proposal must contain new work');
 const pairs=new Set(),links=list(value.links,100).map(row=>{
  object(row,['id','task_id','experiment_id']);const id=unique(row.id),task_id=catalogUuid(row.task_id),experiment_id=catalogUuid(row.experiment_id),pair=task_id+':'+experiment_id;
  if(!tasks.some(task=>task.id===task_id)||!experiments.some(experiment=>experiment.id===experiment_id)||pairs.has(pair))fail('Proposal links must connect distinct work in this bundle');pairs.add(pair);return{id,task_id,experiment_id};
 });
 const graph={schema_version:1,target:normalized,tasks,experiments,links};if(Buffer.byteLength(JSON.stringify(graph))>256*1024)fail('Proposal is too large');return graph;
}
export function stableJson(value){if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableJson(value[key])).join(',')+'}';return JSON.stringify(value);}
export function proposalDigest(graph){return createHash('sha256').update(stableJson(graph)).digest('hex');}
export function proposalUuid(namespace,label){const bytes=createHash('sha1').update(Buffer.from(catalogUuid(namespace).replaceAll('-',''),'hex')).update(label).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
export function generatedProposal(id,input,target){
 object(input,['name','description','priority','tasks','experiments','links']);
 const tasks=list(input.tasks??[],40).map((row,index)=>({...object(row,['title','description','priority','due_date']),id:proposalUuid(id,'task:'+index)}));
 const experiments=list(input.experiments??[],20).map((row,index)=>({...object(row,['title','hypothesis','procedure']),id:proposalUuid(id,'experiment:'+index)}));
 const links=list(input.links??[],100).map((row,index)=>{object(row,['task_index','experiment_index']);if(!Number.isSafeInteger(row.task_index)||!Number.isSafeInteger(row.experiment_index)||!tasks[row.task_index]||!experiments[row.experiment_index])fail('Invalid generated work link');return{id:proposalUuid(id,'link:'+index),task_id:tasks[row.task_index].id,experiment_id:experiments[row.experiment_index].id};});
 return validateProposalGraph({schema_version:1,target:target||{mode:'new',project_id:proposalUuid(id,'project'),name:input.name,description:input.description??'',priority:input.priority??'normal'},tasks,experiments,links});
}
