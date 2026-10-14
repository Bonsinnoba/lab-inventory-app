import { authorityIds } from './resource-authority.js';

export function destinationRequests(value) {
  if(!Array.isArray(value)||value.length>25)throw Object.assign(new Error('Supply at most 25 destinations'),{status:400});
  const seen=new Set();
  return value.map(row=>{
    if(!row||!['note','project'].includes(row.kind)||Object.keys(row).some(k=>!['kind','id'].includes(k)))
      throw Object.assign(new Error('Invalid resource destination'),{status:400});
    const id=authorityIds([row.id])[0],key=`${row.kind}:${id}`;
    if(seen.has(key))throw Object.assign(new Error('Duplicate destination'),{status:400});
    seen.add(key);return {kind:row.kind,id};
  });
}
export function destinationScope(kind,row){
  return {project_id:kind==='project'?row.id:row.project_id??null,visibility:row.visibility??'lab'};
}
export function destinationAuthority(request,before,after,allowed){
  const scope=after?destinationScope(request.kind,after):null;
  const stable=before?.id===request.id&&after?.id===request.id&&JSON.stringify(destinationScope(request.kind,before))===JSON.stringify(scope);
  return {...request,can_attach:Boolean(allowed&&stable),scope:allowed&&stable?scope:null};
}
