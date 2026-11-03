import {linkedProjectReadSql} from './middleware/visibility.js';
import {catalogUuid} from './catalog-sync.js';
import {getUserPermissions} from './middleware/permissions.js';

export async function readSalvageCustodySources(client,user,itemId){
 const id=catalogUuid(itemId);
 const principal=(await client.query('SELECT role,is_active FROM users WHERE id=$1',[user.userId])).rows[0];
 if(!principal?.is_active)throw Object.assign(Error('Account is inactive'),{status:403,code:'ACCOUNT_DISABLED'});
 const permissions=await getUserPermissions(user.userId,principal.role,{client});
 if(!permissions.has('inventory.view'))throw Object.assign(Error('Inventory view permission required'),{status:403,code:'PERMISSION_DENIED'});
 const records=await client.query(`SELECT c.*,p.name AS project_name,
  recipient.username AS recipient_username,recipient.display_name AS recipient_display_name
  FROM item_custody_records c LEFT JOIN projects p ON p.id=c.project_id
  LEFT JOIN users recipient ON recipient.id=c.recipient_id
  WHERE c.item_id=$3 AND c.status IN ('issued','partially_settled')
  AND c.outstanding_quantity>0 AND ${linkedProjectReadSql('c.project_id','$1','$2')}
  ORDER BY c.id`,[user.userId,principal.role,id]);
 return records.rows;
}
export async function readSalvageSources(client,user,itemId){
 if(typeof itemId!=='string'||! /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(itemId))throw Object.assign(Error('Valid inventory item required'),{status:400,code:'INVALID_ITEM_ID'});
 const principal=(await client.query('SELECT role,is_active FROM users WHERE id=$1',[user.userId])).rows[0];
 if(!principal?.is_active)throw Object.assign(Error('Account is inactive'),{status:403,code:'ACCOUNT_DISABLED'});
 const records=await client.query(`SELECT m.id,m.item_id,m.project_id,m.movement_type,m.quantity,m.quantity_before,m.quantity_after,m.created_at,m.reason,m.reference,p.name AS project_name
  FROM item_movements m LEFT JOIN projects p ON p.id=m.project_id
  WHERE m.item_id=$3 AND m.movement_type='consume' AND ${linkedProjectReadSql('m.project_id','$1','$2')}
  ORDER BY m.created_at DESC,m.id`,[user.userId,principal.role,itemId]);
 return records.rows;
}
export async function readSalvageSnapshot(client,user,filters={}){
 const principal=(await client.query('SELECT role,is_active FROM users WHERE id=$1',[user.userId])).rows[0];
 if(!principal?.is_active)throw Object.assign(Error('Account is inactive'),{status:403,code:'ACCOUNT_DISABLED'});
 const values=[user.userId,principal.role],conditions=[linkedProjectReadSql('s.project_id','$1','$2')];
 if(filters.status){values.push(filters.status);conditions.push(`s.quarantine_status=$${values.length}`);}
 if(filters.project_id){values.push(filters.project_id);conditions.push(`s.project_id=$${values.length}`);}
 const records=(await client.query(`SELECT s.*,si.name AS source_item_name,p.name AS project_name,
  qb.username AS quarantined_by_username,ib.username AS inspected_by_username
  FROM item_salvage_recoveries s LEFT JOIN items si ON si.id=s.source_item_id
  LEFT JOIN projects p ON p.id=s.project_id LEFT JOIN users qb ON qb.id=s.quarantined_by
  LEFT JOIN users ib ON ib.id=s.inspected_by WHERE ${conditions.join(' AND ')} ORDER BY s.created_at DESC,s.id`,values)).rows;
 return{records,snapshot_complete:true,snapshot_at:new Date().toISOString()};
}
