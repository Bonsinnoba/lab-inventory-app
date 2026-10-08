import { pool } from './db.js';
import { getUserPermissions } from './middleware/permissions.js';
import { writeAuditLog } from './middleware/audit.js';

// Identifiers are exclusively from this allowlist, never from request strings.
const catalogs = {
  supplier: { table:'suppliers', relation:'supplier_id', fields:['name','contact_name','email','phone','website','notes'], defaults:{notes:''} },
  storage_container: { table:'storage_containers', relation:'storage_container_id', fields:['name','container_type','storage_location','capacity','notes'], defaults:{container_type:'box'} },
};
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
function catalog(type){const c=Object.hasOwn(catalogs,type)?catalogs[type]:null;if(!c)fail(400,'INVALID_CATALOG','Unsupported catalog');return c;}
export function catalogUuid(id){
  if(typeof id!=='string')fail(400,'INVALID_SYNC_ID','A UUID is required');
  const compact=id.replaceAll('-','').toLowerCase();
  if(!/^[0-9a-f]{32}$/.test(compact))fail(400,'INVALID_SYNC_ID','Invalid catalog UUID');
  return compact.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
}
export async function authorizeCatalog(type,operation,user){
  catalog(type);
  const permissions=await getUserPermissions(user.userId,user.role);
  const capability=operation==='create'?'inventory.create':operation==='delete'?'inventory.delete':'inventory.edit';
  if(!permissions.has('inventory.view') || operation!=='read'&&!permissions.has(capability))fail(403,'PERMISSION_DENIED','Inventory permission is required');
  if(type==='supplier'&&operation==='delete'&&user.role!=='admin')fail(403,'PERMISSION_DENIED','Only administrators may delete suppliers');
}
function validate(type,record,creating){
  const config=catalog(type), result=creating?{...config.defaults}:{};
  if(!record||typeof record!=='object'||Array.isArray(record))fail(400,'INVALID_CATALOG_RECORD','Catalog record is required');
  for(const field of config.fields){
    if(!Object.hasOwn(record,field))continue;
    let value=record[field];
    if(field==='capacity'){
      if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<0))fail(400,'INVALID_CAPACITY','Capacity must be a nonnegative number');
    }else{
      if(value!==null&&(typeof value!=='string'||value.length>(field==='notes'?10000:1000)))fail(400,'INVALID_CATALOG_RECORD',`Invalid ${field}`);
      if(typeof value==='string'&&field!=='notes')value=value.trim();
      if((field==='name'||field==='container_type'||type==='supplier'&&field==='notes')&&value===null)fail(400,'INVALID_CATALOG_RECORD',`${field} cannot be null`);
      if((field==='name'||field==='container_type')&&!value)fail(400,'INVALID_CATALOG_RECORD',`${field} is required`);
    }
    result[field]=value;
  }
  if(creating&&!result.name)fail(400,'INVALID_CATALOG_RECORD','Name is required');
  return result;
}
export async function readCatalog(type,user){
  await authorizeCatalog(type,'read',user);const c=catalog(type);
  return (await pool.query(`SELECT c.*,COUNT(i.id)::int AS item_count FROM ${c.table} c LEFT JOIN items i ON i.${c.relation}=c.id GROUP BY c.id ORDER BY c.name,c.id`)).rows.map(r=>type==='storage_container'?{...r,capacity:r.capacity===null?null:Number(r.capacity)}:r);
}
// Caller commits business mutation, tombstone, required audit and receipt together.
export async function applyCatalogChange(client,change,user){
  const type=change.entity_type,c=catalog(type),op=change.operation;
  if(!['create','update','delete'].includes(op))fail(400,'INVALID_OPERATION','Invalid catalog operation');
  await authorizeCatalog(type,op,user);
  const id=catalogUuid(change.entity_id),p=change.payload;
  if(!p?.record||catalogUuid(p.record.id)!==id)fail(400,'INVALID_SYNC_ID','Catalog IDs disagree');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[type+':'+id]);
  if(p.depends_on){
    const prior=await client.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1 AND user_id=$2 AND entity_type=$3 AND entity_id=$4',[p.depends_on,user.userId,type,id]);
    if(!prior.rowCount)fail(409,'SYNC_DEPENDENCY_PENDING','Resolve the preceding catalog edit first');
  }
  const old=(await client.query(`SELECT * FROM ${c.table} WHERE id=$1 FOR UPDATE`,[id])).rows[0];
  const deleted=(await client.query('SELECT 1 FROM sync_tombstones WHERE entity_type=$1 AND entity_id=$2',[type,id])).rowCount;
  if(op==='create'&&(old||deleted))fail(409,'SYNC_CONFLICT','Identity already exists or was deleted');
  if(op!=='create'&&!old){if(op==='delete'&&deleted)return{id,deleted:true,success:true};fail(409,'SYNC_CONFLICT','Catalog record no longer exists');}
  if(old&&(!Number.isSafeInteger(p.expected_version)||old.sync_version!==p.expected_version))fail(409,'SYNC_CONFLICT','Catalog record changed. Review and reapply your edit.');
  let result;
  if(op==='delete'){
    // Row lock also blocks concurrent FK assignments until this transaction ends.
    if(type==='storage_container'&&(await client.query('SELECT 1 FROM items WHERE storage_container_id=$1 LIMIT 1',[id])).rowCount)fail(409,'CONTAINER_HAS_ITEMS','Move linked items before deleting this container');
    if(type==='supplier')await client.query('UPDATE items SET supplier_id=NULL,updated_at=clock_timestamp() WHERE supplier_id=$1',[id]);
    await client.query(`DELETE FROM ${c.table} WHERE id=$1`,[id]);result={id,deleted:true,success:true};
  }else{
    const values=validate(type,p.record,op==='create'),keys=Object.keys(values);
    if(!keys.length)fail(400,'INVALID_CATALOG_RECORD','No fields to update');
    const args=keys.map(k=>values[k]);
    if(op==='create'){
      result=(await client.query(`INSERT INTO ${c.table}(${keys.join(',')},id,created_by) VALUES(${args.map((_,i)=>'$'+(i+1)).join(',')},$${args.length+1},$${args.length+2}) RETURNING *`,[...args,id,user.userId])).rows[0];
    }else{
      result=(await client.query(`UPDATE ${c.table} SET ${keys.map((k,i)=>k+'=$'+(i+1)).join(',')} WHERE id=$${args.length+1} RETURNING *`,[...args,id])).rows[0];
    }
  }
  await writeAuditLog({req:{user},client,required:true,action:op.toUpperCase(),entityType:type,entityId:id,oldValue:old??null,newValue:result,metadata:{change_id:change.change_id}});
  return result;
}
export function catalogHttpMutation(type,operation){return async(req,res,next)=>{
  let client;
  try{
    await authorizeCatalog(type,operation,req.user); // Reauthorize even an already committed replay.
    const key=catalogUuid(req.get('Idempotency-Key'));
    const id=catalogUuid(operation==='create'?req.body?.id:req.params.id);
    const record={...req.body,id};delete record.expected_version;
    const payload={record,expected_version:req.body?.expected_version??0,depends_on:null};
    client=await pool.connect();await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sync-change:'+key]);
    const prior=(await client.query('SELECT * FROM sync_idempotency WHERE change_id=$1',[key])).rows[0];
    let result;
    if(prior){
      const same=(await client.query('SELECT $1::jsonb=$2::jsonb AS same',[prior.payload_json,payload])).rows[0].same;
      if(prior.user_id!==req.user.userId||prior.device_id!=='catalog-http'||prior.entity_type!==type||prior.entity_id!==id||prior.operation!==operation||!same)fail(409,'IDEMPOTENCY_MISMATCH','Key belongs to another catalog intent');
      result=prior.response_json;
    }else{
      result=await applyCatalogChange(client,{change_id:key,entity_type:type,entity_id:id,operation,payload},req.user);
      await client.query('INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,200)',[key,'catalog-http',req.user.userId,type,id,operation,payload,result]);
    }
    await client.query('COMMIT');res.status(operation==='create'?201:200).json(result);
  }catch(error){
    if(client)await client.query('ROLLBACK').catch(()=>{});
    if(error.status)return res.status(error.status).json({error:{code:error.code,message:error.message}});
    if(error.code==='23505')return res.status(409).json({error:{code:'CATALOG_NAME_EXISTS',message:'This catalog name already exists'}});
    next(error);
  }finally{client?.release();}
};}
