import {catalogUuid} from './catalog-sync.js';
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
// A native-authored creation dependency only establishes ordering. Current
// source/destination authority is still checked by the resource mutation itself.
export async function requireResourceDestinationDependencies(client,change,user){
 const dependencies=change.payload?.destination_dependencies;if(dependencies===undefined)return;
 if(!Array.isArray(dependencies)||dependencies.length!==1||!['create','create_copy','attach'].includes(change.operation))fail(400,'INVALID_RESOURCE_DESTINATION_DEPENDENCY','One explicit destination creation dependency is required');
 const destination=change.operation==='attach'?change.payload.attachment?.destination:change.payload.resource;
 const dependency=dependencies[0],kind=dependency?.entity_type;
 if(!['project','note'].includes(kind)||Object.keys(dependency).some(k=>!['change_id','entity_type','entity_id'].includes(k)))fail(400,'INVALID_RESOURCE_DESTINATION_DEPENDENCY','Unsupported destination dependency');
 const entityId=catalogUuid(dependency.entity_id),changeId=catalogUuid(dependency.change_id);
 if(destination?.[`${kind}_id`]!==entityId||changeId===change.change_id)fail(400,'INVALID_RESOURCE_DESTINATION_DEPENDENCY','Destination dependency identity mismatch');
 const prior=(await client.query('SELECT user_id,device_id,entity_type,entity_id,operation,response_json,response_status FROM sync_idempotency WHERE change_id=$1',[changeId])).rows[0];
 if(!prior)fail(503,'RESOURCE_DESTINATION_PENDING','Synchronize the destination creation before this resource; saved work remains pending');
 if(prior.user_id!==user.userId||prior.device_id!==change.__device_id||prior.entity_type!==kind||prior.entity_id!==entityId||prior.operation!=='create'||prior.response_status!==200||prior.response_json?.id!==entityId)fail(409,'RESOURCE_DESTINATION_DEPENDENCY_MISMATCH','The destination receipt does not belong to this author, device and creation');
}
