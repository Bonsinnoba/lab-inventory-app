//! Shared inventory snapshot boundaries. Pending intent is never a server cache.
use rusqlite::{params,Connection,OptionalExtension,TransactionBehavior};
use serde_json::Value;
use std::collections::HashSet;
use crate::{local_auth,local_db};

pub(crate) fn canonical_id(id:&str)->Result<String,String>{uuid::Uuid::parse_str(id).map(|id|id.to_string()).map_err(|_|"Invalid inventory UUID".into())}
pub(crate) fn decode(raw:&str)->Result<Vec<Value>,String>{
    let mut rows:Vec<Value>=serde_json::from_str(raw).map_err(|e|format!("Invalid inventory snapshot: {e}"))?;
    let mut ids=HashSet::new();
    for row in &mut rows{
        let id=canonical_id(row["id"].as_str().ok_or("Inventory ID missing")?)?;
        if !ids.insert(id.clone()){return Err("Duplicate inventory identity in snapshot".into())}
        row["id"]=Value::String(id);
    }Ok(rows)
}
pub(crate) fn read(c:&Connection)->Result<Option<Vec<Value>>,String>{
    let raw:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(c,"inventory_snapshot")?],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    raw.map(|raw|decode(&raw)).transpose()
}
pub(crate) fn write(c:&Connection,rows:&[Value])->Result<(),String>{
    c.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![local_db::scoped_state_key(c,"inventory_snapshot")?,serde_json::to_string(rows).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;Ok(())
}
pub(crate) fn require_base(c:&Connection,account:&str,base:&str)->Result<(),String>{
    local_db::require_sync_account(c,account)?;
    local_auth::require_local_permission(c,"inventory.view")?;
    let current=read(c)?.ok_or("Download inventory before editing")?;
    if current!=decode(base)?{return Err("Inventory changed while this edit was being prepared. Refresh and try again; nothing was saved.".into())}Ok(())
}
pub(crate) fn pending_items(c:&Connection)->Result<HashSet<String>,String>{
    let mut pending=HashSet::new();
    let mut stmt=c.prepare("SELECT entity_type,entity_id,operation,payload_json FROM active_sync_outbox WHERE synced_at IS NULL AND entity_type IN ('item','item_movement')").map_err(|e|e.to_string())?;
    let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?))).map_err(|e|e.to_string())?;
    for row in rows{
        let (kind,id,op,raw)=row.map_err(|e|e.to_string())?;let payload:Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
        if op=="import"{
            for id in target_ids(&kind,id.as_deref(),&op,&payload)?{pending.insert(id);}
        }else if ["bulk_status","bulk_delete","item_bulk_status","item_bulk_delete"].contains(&op.as_str()){
            for id in payload["ids"].as_array().ok_or("Invalid queued inventory batch")?{pending.insert(canonical_id(id.as_str().ok_or("Invalid queued inventory ID")?)?);}
        }else{
            let id=id.as_deref().or_else(||payload[if kind=="item_movement"{"item_id"}else{"id"}].as_str()).ok_or("Queued inventory target missing")?;
            pending.insert(canonical_id(id)?);
        }
    }Ok(pending)
}
pub(crate) fn merge(c:&mut Connection,account:&str,incoming:Vec<Value>,deleted:Vec<String>,cursor:Option<&str>)->Result<(),String>{
    // Cursor-bearing responses are incremental; a cache refresh is a complete list.
    let incoming=decode(&serde_json::to_string(&incoming).map_err(|e|e.to_string())?)?;
    let deleted:HashSet<String>=deleted.iter().map(|id|canonical_id(id)).collect::<Result<_,_>>()?;
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    local_db::require_sync_account(&tx,account)?;local_auth::require_local_permission(&tx,"inventory.view")?;
    let pending=pending_items(&tx)?;let mut current=read(&tx)?.unwrap_or_default();
    current.retain(|row|{let id=row["id"].as_str().unwrap();pending.contains(id)||(cursor.is_some()&&!deleted.contains(id))});
    for row in incoming{
        let id=row["id"].as_str().unwrap();if pending.contains(id)||deleted.contains(id){continue}
        current.retain(|old|old["id"]!=id);current.push(row);
    }
    write(&tx,&current)?;
    if let Some(cursor)=cursor{tx.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![local_db::scoped_state_key(&tx,"inventory_sync_cursor")?,cursor]).map_err(|e|e.to_string())?;}
    tx.commit().map_err(|e|e.to_string())
}

pub(crate) fn save(c:&mut Connection,input:local_db::LocalSyncWriteInput)->Result<(),String>{
    let mut rows=decode(&input.snapshot_json)?;
    let mut payload:Value=serde_json::from_str(&input.payload_json).map_err(|e|e.to_string())?;
    if input.entity_type!="item"||!payload.is_object()||input.state_key.is_some()||input.state_json.is_some(){return Err("Unsupported inventory write".into())}
    let permission=match input.operation.as_str(){"create"=>"inventory.create","update"|"bulk_status"=>"inventory.edit","delete"|"bulk_delete"=>"inventory.delete",_=>return Err("Unsupported inventory operation".into())};
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    require_base(&tx,&input.expected_account_id,&input.expected_snapshot_json)?;
    local_auth::require_local_permission(&tx,permission)?;
    let entity=input.entity_id.as_deref().map(canonical_id).transpose()?;
    stamp_versions(&tx,"item",entity.as_deref(),&input.operation,&mut payload,&mut rows)?;
    write(&tx,&rows)?;
    let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'item',?3,?4,?5)",params![input.change_id,device,entity,input.operation,payload.to_string()]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())
}

pub(crate) fn target_ids(kind:&str,entity:Option<&str>,op:&str,payload:&Value)->Result<Vec<String>,String>{
    let values=if op=="import"{
        payload["rows"].as_array().ok_or("Inventory import rows missing")?.iter().map(|v|v["record"]["id"].as_str().ok_or("Invalid inventory import target")).collect::<Result<Vec<_>,_>>()?
    }else if ["bulk_status","bulk_delete","item_bulk_status","item_bulk_delete"].contains(&op){
        payload["ids"].as_array().ok_or("Inventory batch targets missing")?.iter().map(|v|v.as_str().ok_or("Invalid inventory target")).collect::<Result<Vec<_>,_>>()?
    }else{vec![entity.or_else(||payload[if kind=="item_movement"{"item_id"}else{"id"}].as_str()).ok_or("Inventory target missing")?]};
    let mut ids=values.into_iter().map(canonical_id).collect::<Result<Vec<_>,_>>()?;ids.sort();ids.dedup();
    if ids.is_empty()||ids.len()>1000{return Err("Provide 1–1000 inventory targets".into())}Ok(ids)
}

pub(crate) fn stamp_versions(c:&Connection,kind:&str,entity:Option<&str>,op:&str,payload:&mut Value,next:&mut [Value])->Result<(),String>{
    let ids=target_ids(kind,entity,op,payload)?;let current=read(c)?.ok_or("Inventory is not initialized")?;
    let mut predecessors=std::collections::HashMap::new();
    let mut stmt=c.prepare("SELECT change_id,entity_type,entity_id,operation,payload_json FROM sync_outbox WHERE change_id IN (SELECT change_id FROM active_sync_outbox WHERE synced_at IS NULL) AND entity_type IN ('item','item_movement') ORDER BY rowid DESC").map_err(|e|e.to_string())?;
    let queued=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?))).map_err(|e|e.to_string())?;
    for row in queued{let (change,k,id,operation,raw)=row.map_err(|e|e.to_string())?;let p:Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
        for target in target_ids(&k,id.as_deref(),&operation,&p)?{if ids.contains(&target){predecessors.entry(target).or_insert(change.clone());}}
    }
    let creating=kind=="item"&&op=="create";let deleting=kind=="item"&&["delete","bulk_delete"].contains(&op);let mut bases=vec![];
    for id in &ids{
        let old=current.iter().find(|r|r["id"]==*id);
        let version=if creating{if old.is_some()||predecessors.contains_key(id){return Err("Inventory identity already exists or has pending work".into())}0}
        else{old.and_then(|r|r["sync_version"].as_i64()).filter(|v|*v>0).ok_or("Refresh inventory online to obtain its version before editing")?};
        bases.push(serde_json::json!({"id":id,"version":version,"depends_on":predecessors.get(id)}));
        if !deleting{let row=next.iter_mut().find(|r|r["id"]==*id).ok_or("Updated inventory target missing")?;row["sync_version"]=serde_json::json!(version.checked_add(1).ok_or("Inventory version exhausted")?);}
    }
    payload["inventory_protocol"]=serde_json::json!(2);payload["item_bases"]=serde_json::json!(bases);
    if op.starts_with("bulk_"){payload["ids"]=serde_json::json!(ids);}else if kind=="item"{payload["id"]=serde_json::json!(ids[0]);}
    Ok(())
}

// A shared bulk event cannot be partially discarded. Include connected item chains.
pub(crate) fn discard_connected(c:&Connection,change:&str,resolution:&str)->Result<(),String>{
    let mut stmt=c.prepare("SELECT change_id,entity_type,entity_id,operation,payload_json FROM active_sync_outbox WHERE synced_at IS NULL AND entity_type IN ('item','item_movement')").map_err(|e|e.to_string())?;
    let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?))).map_err(|e|e.to_string())?;
    let mut changes=vec![];for row in rows{let (key,k,id,op,raw)=row.map_err(|e|e.to_string())?;let payload:Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;changes.push((key,target_ids(&k,id.as_deref(),&op,&payload)?));}
    let mut targets:HashSet<String>=changes.iter().find(|(key,_)|key==change).ok_or("Pending inventory change missing")?.1.iter().cloned().collect();
    loop{let before=targets.len();for (_,ids) in &changes{if ids.iter().any(|id|targets.contains(id)){targets.extend(ids.iter().cloned());}}if targets.len()==before{break}}
    for (key,ids) in changes{if ids.iter().any(|id|targets.contains(id)){
        c.execute("UPDATE sync_conflicts SET resolved_at=CURRENT_TIMESTAMP,resolution=?2 WHERE change_id=?1",params![key,resolution]).map_err(|e|e.to_string())?;
        c.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP,last_error=NULL WHERE change_id=?1",[key]).map_err(|e|e.to_string())?;
    }}Ok(())
}

#[cfg(test)]
#[path="inventory_sync_state_test.rs"]
mod tests;
#[cfg(test)]
#[path="inventory_sync_state_live_test.rs"]
mod live_tests;
