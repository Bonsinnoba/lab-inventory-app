export interface ProposalGraph {schema_version:1;target:{mode:'new'|'existing';project_id:string;name?:string;description?:string;priority?:string;expected_lifecycle_revision?:number};tasks:any[];experiments:any[];links:any[];}
function catalogUuid(value:any):string{if(typeof value!=='string'||!/^([0-9a-f]{32}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(value))throw new Error('Invalid proposal UUID');const h=value.replaceAll('-','').toLowerCase();return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
const fail=(message:string):never=>{throw Object.assign(new Error(message),{status:400,code:'INVALID_ASSISTANT_PROPOSAL'});};
function object(value:any,keys:string[]){if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(key=>!keys.includes(key)))fail('Proposal contains unsupported fields');return value;}
function text(value:any,max:number,required=false){if(typeof value!=='string'||/[\uD800-\uDFFF]/u.test(value)||value.length>max||required&&!value.trim())fail('Invalid proposal text');return value.trim();}
function date(value:any){if(value===null||value===undefined||value==='')return null;if(typeof value!=='string'||(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000-'))||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail('Invalid proposal date');return value;}
function priority(value:any='normal'){if(!['low','normal','high','critical'].includes(value))fail('Invalid proposal priority');return value;}
function list(value:any,max:number):any[]{if(!Array.isArray(value)||value.length>max)fail('Proposal exceeds its work limits');return value;}
export function validateProposalGraph(value:any):ProposalGraph{
 object(value,['schema_version','target','tasks','experiments','links']);if(value.schema_version!==1)fail('Unsupported proposal schema');
 const target=object(value.target,['mode','project_id','name','description','priority','expected_lifecycle_revision']);
 if(!['new','existing'].includes(target.mode))fail('Invalid proposal target');
 const projectId=catalogUuid(target.project_id),ids=new Set([projectId]);
 const unique=(id:any)=>{id=catalogUuid(id);if(ids.has(id))fail('Proposal identifiers must be unique');ids.add(id);return id;};
 let normalized:any;
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
 const graph={schema_version:1,target:normalized,tasks,experiments,links};if(new TextEncoder().encode(JSON.stringify(graph)).length>256*1024)fail('Proposal is too large');return graph as ProposalGraph;
}
export function stableJson(value:any):string{if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableJson(value[key])).join(',')+'}';return JSON.stringify(value);}

export async function proposalDigest(graph:ProposalGraph):Promise<string>{const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson(validateProposalGraph(graph))));return Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,'0')).join('');}
