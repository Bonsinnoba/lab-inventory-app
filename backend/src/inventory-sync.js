import {catalogUuid} from './catalog-sync.js';
import {getUserPermissions} from './middleware/permissions.js';
import {writeAuditLog} from './middleware/audit.js';
import {applyInventoryRaw} from './inventory-apply.js';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
function targets(change){
  const p=change.payload;
  if(!p||typeof p!=='object'||Array.isArray(p))fail(400,'INVALID_INVENTORY','Inventory payload required');
  if(['bulk_status','bulk_delete'].includes(change.operation)){
    if(change.entity_type!=='item'||!Array.isArray(p.ids)||!p.ids.length||p.ids.length>1000)fail(400,'INVALID_INVENTORY','Provide 1–1000 inventory targets');
    const ids=p.ids.map(catalogUuid);if(new Set(ids).size!==ids.length)fail(400,'INVALID_INVENTORY','Duplicate inventory target');return ids.sort();
  }
  const id=catalogUuid(change.entity_id);
  if(catalogUuid(change.entity_type==='item_movement'?p.item_id:p.id)!==id)fail(400,'INVALID_INVENTORY','Inventory target IDs disagree');
  return[id];
}
// Applies inside the broker transaction. Versions cover every SQL writer via trigger.
// Legacy outbox payloads are immutable and retain their previous semantics.
export async function applyInventoryMutation(client,change,user,apply=()=>applyInventoryRaw(client,change,user.userId)){
  if(change.entity_type==='item'&&change.operation==='import')return applyInventoryImport(client,change,user);
  const p=change.payload,versioned=p?.inventory_protocol===2;
  if(p?.inventory_protocol!==undefined&&!versioned)fail(400,'INVALID_INVENTORY_PROTOCOL','Unsupported inventory protocol');
  const permissions=await getUserPermissions(user.userId,user.role);
  const capability=change.entity_type==='item_movement'?'inventory.adjust_stock':change.operation==='create'?'inventory.create':['delete','bulk_delete'].includes(change.operation)?'inventory.delete':'inventory.edit';
  if(!permissions.has('inventory.view')||!permissions.has(capability))fail(403,'PERMISSION_DENIED',`${capability} required`);
  // Legacy payloads may omit the repeated id; preserve those keys unchanged.
  const ids=versioned?targets(change):[...new Set((Array.isArray(p?.ids)?p.ids:[change.entity_id]).filter(Boolean).map(catalogUuid))].sort();
  if(!ids.length)fail(400,'INVALID_INVENTORY','Inventory target required');
  for(const id of ids)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['inventory:'+id]);
  const before=(await client.query('SELECT * FROM items WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids])).rows;
  const creating=change.entity_type==='item'&&change.operation==='create';
  if(creating&&(await client.query("SELECT 1 FROM sync_tombstones WHERE entity_type='item' AND entity_id=ANY($1::uuid[])",[ids])).rowCount)fail(409,'SYNC_CONFLICT','Deleted inventory IDs cannot be reused');
  if(versioned){
    if(p.conflict_resolution)fail(409,'SYNC_CONFLICT','Review and reapply versioned edits; automatic overwrite is not supported');
    if(!Array.isArray(p.item_bases)||p.item_bases.length!==ids.length)fail(400,'INVALID_INVENTORY_BASE','One version base is required per item');
    const bases=new Map();
    for(const base of p.item_bases){const id=catalogUuid(base?.id);if(!ids.includes(id)||bases.has(id)||!Number.isSafeInteger(base.version)||base.version<0)fail(400,'INVALID_INVENTORY_BASE','Invalid inventory version base');bases.set(id,base);}
    const additive=change.entity_type==='item_movement'&&['receive','checkout','return','consume','damage','loss','repair_out','repair_in'].includes(p.movement_type);
    for(const id of ids){
      const base=bases.get(id),row=before.find(row=>row.id===id);let expected=base.version;
      if(base.depends_on){
        const prior=(await client.query("SELECT response_json FROM sync_idempotency WHERE change_id=$1 AND user_id=$2 AND device_id=$3 AND entity_type IN ('item','item_movement')",[base.depends_on,user.userId,change.__device_id])).rows[0];
        if(!prior||!Object.hasOwn(prior.response_json?.inventory_versions||{},id))fail(409,'SYNC_DEPENDENCY_PENDING','Resolve the preceding authored inventory change first');
        expected=prior.response_json.inventory_versions[id];
        if(!Number.isSafeInteger(expected))fail(409,'SYNC_CONFLICT','The preceding change deleted this item');
      }
      if(creating){if(row||expected!==0||base.depends_on)fail(409,'SYNC_CONFLICT','Inventory identity already exists');}
      else if(!row)fail(409,'SYNC_CONFLICT','Inventory target no longer exists');
      else if(!additive&&row.sync_version!==expected)fail(409,'SYNC_CONFLICT','Inventory changed on another client. Review and reapply this edit.');
    }
  }
  const result=await apply();
  const rows=(await client.query('SELECT id,sync_version FROM items WHERE id=ANY($1::uuid[])',[ids])).rows;
  const inventory_versions=Object.fromEntries(ids.map(id=>[id,rows.find(row=>row.id===id)?.sync_version??null]));
  if(change.entity_type==='item'&&change.operation==='update'&&before[0]){
    for(const field of Object.keys(before[0])){
      if(['sync_version','updated_at','created_at'].includes(field)||!Object.hasOwn(result,field))continue;
      if(String(before[0][field]??'')!==String(result[field]??''))await client.query('INSERT INTO item_history(item_id,field_name,old_value,new_value,changed_by) VALUES($1,$2,$3,$4,$5)',[ids[0],field,before[0][field]==null?null:String(before[0][field]),result[field]==null?null:String(result[field]),user.userId]);
    }
  }
  await writeAuditLog({req:{user},client,required:true,action:`sync:${change.operation}`,entityType:change.entity_type,entityId:ids.length===1?ids[0]:null,oldValue:ids.length===1?before[0]??null:before,newValue:result,deviceId:change.__device_id,metadata:{change_id:change.change_id,ids,inventory_protocol:versioned?2:1}});
  return{...result,inventory_versions};
}

export async function authorizeInventoryImport(payload,user){
  if(payload?.inventory_protocol!==2||!Array.isArray(payload.rows)||!payload.rows.length||payload.rows.length>500)fail(400,'INVALID_INVENTORY_IMPORT','Provide 1–500 versioned inventory rows');
  const permissions=await getUserPermissions(user.userId,user.role);
  if(!permissions.has('inventory.view')||!permissions.has('inventory.import'))fail(403,'PERMISSION_DENIED','inventory.view and inventory.import required');
  const ids=new Set();
  for(const row of payload.rows){
    if(!['create','update'].includes(row?.operation)||!row.record||typeof row.record!=='object'||Array.isArray(row.record))fail(400,'INVALID_INVENTORY_IMPORT','Explicit create/update records required');
    const id=catalogUuid(row.record.id);if(ids.has(id))fail(400,'INVALID_INVENTORY_IMPORT','Duplicate inventory import identity');ids.add(id);
    if(!permissions.has('inventory.'+(row.operation==='create'?'create':'edit')))fail(403,'PERMISSION_DENIED','Permission required for every imported row');
    if(typeof row.record.name!=='string'||!row.record.name.trim()||typeof row.record.type!=='string'||!row.record.type.trim())fail(400,'INVALID_INVENTORY_IMPORT','Name and type are required');
    for(const field of ['initial_quantity','current_quantity'])if(row.record[field]===null||row.record[field]===undefined||!Number.isFinite(Number(row.record[field]))||Number(row.record[field])<0)fail(400,'INVALID_INVENTORY_IMPORT','Nonnegative quantities are required');
  }
  return permissions;
}
async function applyInventoryImport(client,change,user){
  const p=change.payload,permissions=await authorizeInventoryImport(p,user);
  if(!Array.isArray(p.item_bases)||p.item_bases.length!==p.rows.length)fail(400,'INVALID_INVENTORY_BASE','One import base per row is required');
  const rows=[...p.rows].sort((a,b)=>catalogUuid(a.record.id).localeCompare(catalogUuid(b.record.id)));
  // Acquire the entire set first, so competing batches cannot interleave.
  for(const row of rows)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['inventory:'+catalogUuid(row.record.id)]);
  let created=0,updated=0;const inventory_versions={};
  for(const row of rows){
    const id=catalogUuid(row.record.id),bases=p.item_bases.filter(b=>catalogUuid(b?.id)===id);
    if(bases.length!==1)fail(400,'INVALID_INVENTORY_BASE','Missing or duplicated import base');
    if(row.operation==='update'){
      const old=(await client.query('SELECT current_quantity FROM items WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(old&&Number(old.current_quantity)!==Number(row.record.current_quantity)&&!permissions.has('inventory.adjust_stock'))fail(403,'PERMISSION_DENIED','inventory.adjust_stock required for quantity changes');
    }
    const payload={...(row.operation==='create'?row.record:{id,patch:row.record}),id,inventory_protocol:2,item_bases:bases};
    const result=await applyInventoryMutation(client,{...change,operation:row.operation,entity_id:id,payload},user);
    Object.assign(inventory_versions,result.inventory_versions);
    if(row.operation==='create')created++;else updated++;
  }
  return{imported:created+updated,created,updated,inventory_versions};
}
