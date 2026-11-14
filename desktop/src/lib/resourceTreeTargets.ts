import type {Resource} from '../api/resources';
// Picker filtering is a convenience, not authorization. Native/server guards
// independently verify the complete reviewed tree, scope, cycles and depth.
export function resourceTreeTargets(resources:Resource[],movingIds:string[]):Resource[]{
 const blocked=new Set(movingIds);let changed=true;
 while(changed){changed=false;for(const row of resources)if(row.parent_resource_id&&blocked.has(row.parent_resource_id)&&!blocked.has(row.id)){blocked.add(row.id);changed=true;}}
 return resources.filter(row=>row.kind==='folder'&&!blocked.has(row.id));
}
