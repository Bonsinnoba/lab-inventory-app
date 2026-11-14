// Read-only authority projection for the native offline cache. These values are
// decisions from the normal server rules, never grants supplied by a caller.
export function authorityIds(value) {
  if (!Array.isArray(value) || value.length > 100 || value.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))
    throw Object.assign(new Error('Supply at most 100 resource UUIDs'), {status:400,code:'INVALID_RESOURCE_AUTHORITY_REQUEST'});
  const ids=value.map(id=>id.toLowerCase());
  if(new Set(ids).size!==ids.length)throw Object.assign(new Error('Resource identities must be unique'),{status:400,code:'INVALID_RESOURCE_AUTHORITY_REQUEST'});
  return ids;
}
export function resourceScope(row) {
  return Object.fromEntries(['visibility','item_id','project_id','note_id','parent_resource_id'].map(key=>[key,row[key]??(key==='visibility'?'lab':null)]));
}
export function resourceAuthority(id,before,after,allowed) {
  const stable=before&&after&&before.id===id&&after.id===id&&new Date(before.updated_at).getTime()===new Date(after.updated_at).getTime()&&JSON.stringify(resourceScope(before))===JSON.stringify(resourceScope(after));
  if(!allowed||!stable)return {resource_id:id,can_edit:false,revision:null,scope:null};
  return {resource_id:id,can_edit:true,revision:after.updated_at,scope:resourceScope(after)};
}

// Complete leaf-to-root authorization bindings, not a partial ancestor cache.
// A bounded walk must reach a root; cycles, broken parents and missing notes deny.
export function resourceBindings(rows) {
  if(!Array.isArray(rows)||!rows.length||rows.length>32)return null;
  const seen=new Set(),projects=new Set(),bindings=[];
  for(let i=0;i<rows.length;i++){
    const row=rows[i],scope=resourceScope(row);
    if(!row.id||seen.has(row.id)||row.depth!==i||
      (i>0&&row.kind!=='folder')||
      [scope.item_id,scope.project_id,scope.note_id,scope.parent_resource_id].filter(Boolean).length>1||
      (scope.parent_resource_id??null)!==(rows[i+1]?.id??null))return null;
    seen.add(row.id);
    const note=scope.note_id?{id:row.note_id,project_id:row.note_project_id??null,visibility:row.note_visibility??'lab'}:null;
    if(note&&row.resolved_note_id!==note.id)return null;
    if(scope.project_id)projects.add(scope.project_id);
    if(note?.project_id)projects.add(note.project_id);
    bindings.push({resource_id:row.id,kind:row.kind,scope,note});
  }
  return projects.size>1?null:bindings;
}

export function inheritedResourceAuthority(id,before,after,allowed,beforeRows,afterRows) {
  const grant=resourceAuthority(id,before,after,allowed);
  const bindings=resourceBindings(beforeRows),current=resourceBindings(afterRows);
  if(!grant.can_edit||!bindings||bindings[0].resource_id!==id||
    JSON.stringify(bindings)!==JSON.stringify(current)||
    JSON.stringify(bindings[0].scope)!==JSON.stringify(grant.scope))
    return {resource_id:id,can_edit:false,revision:null,scope:null,bindings:null};
  return {...grant,bindings};
}


// Protocol 3 separates the global action permission from record-management
// authority. A delete-only role must never receive edit authority as a shortcut.
export function resourceActionAuthority(grant,permissions){
 const readable=permissions.has('resources.view');
 const can_edit=readable&&grant.can_edit&&permissions.has('resources.edit');
 const can_delete=readable&&grant.can_edit&&permissions.has('resources.delete');
 const can_create_child=readable&&grant.can_edit&&grant.bindings?.[0]?.kind==='folder'&&grant.bindings.length<32&&(permissions.has('resources.create')||permissions.has('resources.edit'));
 if(!can_edit&&!can_delete&&!can_create_child)return {resource_id:grant.resource_id,can_edit:false,can_delete:false,can_create_child:false,revision:null,scope:null,bindings:null};
 return {...grant,can_edit,can_delete,can_create_child};
}
