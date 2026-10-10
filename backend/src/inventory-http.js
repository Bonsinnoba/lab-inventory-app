import {pool} from './db.js';
import {catalogUuid} from './catalog-sync.js';
import {getUserPermissions} from './middleware/permissions.js';
import {applyInventoryMutation,authorizeInventoryImport} from './inventory-sync.js';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const statuses=new Set(['available','in_use','damaged','needs_repair','needs_replacement','low_stock','retired']);
const fields=['name','type','category','sku','initial_quantity','unit','dimensions','status','condition_notes','last_checked_at','unit_cost','replacement_cost','location_id','storage_location','storage_container_id','photo_url','supplier','supplier_id','part_number','acquisition_method','acquisition_source','acquisition_notes','next_maintenance_date','maintenance_interval_days','manufacturer','model_number','serial_number','asset_tag','calibration_interval_days','next_calibration_date','assigned_to','image_resource_id'];

export async function inventoryImportHttpMutation(req,res,next){
  let client;
  try{
    const key=catalogUuid(req.get('Idempotency-Key'));
    await authorizeInventoryImport(req.body,req.user);
    if(!Array.isArray(req.body.item_bases))fail(400,'INVALID_INVENTORY_BASE','Import version bases required');
    const payload={inventory_protocol:2,rows:req.body.rows,item_bases:req.body.item_bases.map(b=>({id:catalogUuid(b?.id),version:b.version,depends_on:null}))};
    client=await pool.connect();await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sync-change:'+key]);
    const prior=(await client.query('SELECT * FROM sync_idempotency WHERE change_id=$1',[key])).rows[0];let result;
    if(prior){
      const same=(await client.query('SELECT $1::jsonb=$2::jsonb AS same',[prior.payload_json,payload])).rows[0].same;
      if(prior.user_id!==req.user.userId||prior.device_id!=='inventory-http'||prior.entity_type!=='item'||prior.operation!=='import'||!same)fail(409,'IDEMPOTENCY_MISMATCH','Key belongs to another import');
      result=prior.response_json;
    }else{
      result=await applyInventoryMutation(client,{change_id:key,entity_type:'item',entity_id:null,operation:'import',payload,__device_id:'inventory-http'},req.user);
      await client.query("INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status) VALUES($1,'inventory-http',$2,'item',NULL,'import',$3,$4,200)",[key,req.user.userId,payload,result]);
    }
    await client.query('COMMIT');res.json({imported:result.imported,created:result.created,updated:result.updated});
  }catch(error){
    if(client)await client.query('ROLLBACK').catch(()=>{});
    if(error.status)return res.status(error.status).json({error:{code:error.code,message:error.message}});
    if(['23503','23505','23514','22P02'].includes(error.code))return res.status(409).json({error:{code:'INVENTORY_CONSTRAINT',message:'Import conflicts with a related record or constraint; no rows were imported'}});
    next(error);
  }finally{client?.release();}
}
function record(body,creating,storageOnly){
  const result={};
  if(!creating&&Object.hasOwn(body,'current_quantity'))fail(400,'USE_STOCK_MOVEMENT','Use a stock movement to change quantity');
  for(const field of storageOnly?['storage_location','storage_container_id']:fields)if(Object.hasOwn(body,field))result[field]=body[field];
  if(creating){
    if(typeof result.name!=='string'||!result.name.trim()||typeof result.type!=='string'||!result.type)fail(400,'INVALID_ITEM','Name and type are required');
    result.sku??=null;result.initial_quantity??=0;result.current_quantity=body.current_quantity??result.initial_quantity;result.status??='available';result.acquisition_method??='unspecified';
  }
  if(Object.hasOwn(result,'status')&&!statuses.has(result.status))fail(400,'INVALID_ITEM_STATUS','Invalid item status');
  if(Object.hasOwn(result,'acquisition_method')&&!['unspecified','purchased','salvaged','donated','transferred','fabricated','other'].includes(result.acquisition_method))fail(400,'INVALID_ACQUISITION_METHOD','Invalid acquisition method');
  for(const field of ['initial_quantity','current_quantity'])if(Object.hasOwn(result,field)&&(!Number.isFinite(Number(result[field]))||Number(result[field])<0))fail(400,'INVALID_QUANTITY','Quantity must be nonnegative');
  if(Object.hasOwn(result,'storage_location'))result.storage_location=result.storage_location==null?null:String(result.storage_location).trim()||null;
  if(Object.hasOwn(result,'sku'))result.sku=typeof result.sku==='string'?result.sku.trim()||null:result.sku;
  if(!creating&&!Object.keys(result).length)fail(400,'INVALID_ITEM','No fields to update');
  return result;
}

// Browser is explicitly online-only. It shares inventory apply/versions with
// desktop sync, but cannot claim a desktop predecessor or downgrade protocol.
export function inventoryHttpMutation(operation,{movement=false,storageOnly=false}={}){
  return async(req,res,next)=>{
    let client;
    try{
      const capability=movement?'inventory.adjust_stock':operation==='create'?'inventory.create':['delete','bulk_delete'].includes(operation)?'inventory.delete':'inventory.edit';
      const permissions=await getUserPermissions(req.user.userId,req.user.role);
      if(!permissions.has('inventory.view')||!permissions.has(capability))fail(403,'PERMISSION_DENIED',`${capability} required`);
      const key=catalogUuid(req.get('Idempotency-Key')),body=req.body||{};
      const bulk=operation.startsWith('bulk_');
      let ids;
      if(bulk){
        if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>500)fail(400,'INVALID_INVENTORY','Provide 1–500 item IDs');
        ids=body.ids.map(catalogUuid).sort();if(new Set(ids).size!==ids.length)fail(400,'INVALID_INVENTORY','Duplicate item IDs');
      }else ids=[catalogUuid(!movement&&operation==='create'?body.id:req.params.id)];
      const id=ids[0],entityType=movement?'item_movement':'item';
      let payload;
      if(movement){
        payload={id:catalogUuid(body.id),item_id:id};
        for(const field of ['movement_type','quantity','to_storage_location','to_location_id','project_id','reason','reference'])if(Object.hasOwn(body,field))payload[field]=body[field];
        if(payload.movement_type==='transfer'&&!String(payload.to_storage_location||'').trim()&&!payload.to_location_id)fail(400,'TRANSFER_LOCATION_REQUIRED','A destination is required for transfers');
      }else if(bulk){
        payload={ids};if(operation==='bulk_status'){if(!statuses.has(body.status))fail(400,'INVALID_ITEM_STATUS','Invalid status');payload.status=body.status;}
      }else if(operation==='create')payload={...record(body,true,false),id};
      else if(operation==='update')payload={id,patch:record(body,false,storageOnly)};
      else payload={id};
      const creating=!movement&&operation==='create';
      payload.inventory_protocol=2;
      if(bulk&&(!Array.isArray(body.item_bases)||body.item_bases.length!==ids.length))fail(400,'INVALID_INVENTORY_BASE','Supply a version for each item');
      payload.item_bases=ids.map(target=>{
        const base=bulk?body.item_bases.filter(b=>catalogUuid(b?.id)===target):null;
        if(base&&base.length!==1)fail(400,'INVALID_INVENTORY_BASE','Supply exactly one version for each item');
        const version=creating?0:bulk?base[0].version:body.expected_version;
        if(!Number.isSafeInteger(version)||version<(creating?0:1))fail(400,'INVALID_INVENTORY_BASE','Refresh inventory and supply its version');
        return{id:target,version,depends_on:null};
      });
      const change={change_id:key,entity_type:entityType,entity_id:bulk?null:id,operation,payload,__device_id:'inventory-http'};
      client=await pool.connect();await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sync-change:'+key]);
      const prior=(await client.query('SELECT * FROM sync_idempotency WHERE change_id=$1',[key])).rows[0];
      let result;
      if(prior){
        const same=(await client.query('SELECT $1::jsonb=$2::jsonb AS same',[prior.payload_json,payload])).rows[0].same;
        if(prior.user_id!==req.user.userId||prior.device_id!=='inventory-http'||prior.entity_type!==entityType||prior.entity_id!==change.entity_id||prior.operation!==operation||!same)fail(409,'IDEMPOTENCY_MISMATCH','This key belongs to another inventory intent');
        result=prior.response_json;
      }else{
        result=await applyInventoryMutation(client,change,req.user);
        await client.query('INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[key,'inventory-http',req.user.userId,entityType,change.entity_id,operation,payload,result,operation==='create'?201:200]);
      }
      await client.query('COMMIT');
      if(operation==='delete')return res.status(204).send();
      const {inventory_versions,...response}=result;
      res.status(operation==='create'?201:200).json(response);
    }catch(error){
      if(client)await client.query('ROLLBACK').catch(()=>{});
      if(error.status)return res.status(error.status).json({error:{code:error.code,message:error.message}});
      if(['23503','23505','23514','22P02'].includes(error.code))return res.status(409).json({error:{code:'INVENTORY_CONSTRAINT',message:'Inventory data conflicts with a related record or constraint'}});
      next(error);
    }finally{client?.release();}
  };
}
