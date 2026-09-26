// Derive only relationships supported by existing foreign keys and project-scoped queries.
// No speculative AI-inferred edges; source refs are stable and can be opened by the UI.
export function projectContextEdges(context){
 if(!context?.scope?.id||!context.sections)return [];
 const project={type:'project',id:context.scope.id};
 const edges=[];
 const add=(type,recordId,relation,source)=>{if(recordId)edges.push({from:project,to:{type,id:recordId},relation,source,authority:'central_postgresql'});};
 for(const e of context.sections.experiments||[])add('experiment',e.id,'contains_experiment','project_experiments.project_id');
 for(const t of context.sections.tasks||[])add('task',t.id,'contains_task','project_tasks.project_id');
 for(const i of context.sections.inventory||[])add('item',i.item_id,'links_item','project_items.project_id');
 for(const r of context.sections.reservations||[]){
  add('reservation',r.id,'has_reservation','project_reservations.project_id');
  if(r.id&&r.item_id)edges.push({from:{type:'reservation',id:r.id},to:{type:'item',id:r.item_id},relation:'reserves_item',source:'project_reservations.item_id',authority:'central_postgresql'});
 }
 for(const n of context.sections.notes||[])add('note',n.id,'has_note','notes.project_id');
 for(const r of context.sections.resources||[])add('resource',r.id,'has_resource','resources.project_id');
 return edges;
}
