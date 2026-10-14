type Change = {change_id:string;entity_type:string;entity_id?:string|null;payload:unknown};

// A failed transfer must also withhold copies of that file and their later
// edits/deletes, while allowing independent changes through the same sync pass.
export function withoutBlockedResources<T extends Change>(changes:T[], blockedResources:ReadonlySet<string>):T[]{
  const resources=new Set(blockedResources);
  const blocked=new Set<string>();
  let grew=true;
  while(grew){
    grew=false;
    for(const change of changes){
      if(change.entity_type!=='resource'||blocked.has(change.change_id))continue;
      const payload=change.payload as {copy?:{source_id?:string;previous_change_id?:string};edit?:{previous_change_id?:string};attachment?:{previous_change_id?:string}}|null;
      const previous=payload?.copy?.previous_change_id??payload?.edit?.previous_change_id??payload?.attachment?.previous_change_id;
      if(resources.has(change.entity_id??'')||(previous&&blocked.has(previous))||(payload?.copy?.source_id&&resources.has(payload.copy.source_id))){
        blocked.add(change.change_id);
        if(change.entity_id)resources.add(change.entity_id);
        grew=true;
      }
    }
  }
  return changes.filter(change=>!blocked.has(change.change_id));
}
