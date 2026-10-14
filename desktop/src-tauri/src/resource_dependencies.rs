//! Resource editor dependencies are account-scoped, immutable outbox identities.
use std::collections::HashSet;
use rusqlite::{params, Connection};
use serde_json::Value;
use crate::{local_db, local_resources};

fn err(e: impl std::fmt::Display) -> String { e.to_string() }

// Called while the copy writer holds its IMMEDIATE transaction. Unsupported
// metadata/attachment intents stay blocked rather than guessing their revision.
pub(crate) fn source_predecessor(c:&Connection, id:&str)->Result<Option<String>,String>{
    crate::local_resource_edits::schema(c)?;
    let device:String=c.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(err)?;
    let mut stmt=c.prepare("SELECT o.change_id,o.device_id,o.operation,o.payload_json,
        EXISTS(SELECT 1 FROM sync_conflicts f WHERE f.change_id=o.change_id AND f.resolved_at IS NULL),
        EXISTS(SELECT 1 FROM local_resource_uploads u WHERE u.account_id=o.account_id AND u.change_id=o.change_id AND u.resource_id=o.entity_id AND u.state='ready'),
        EXISTS(SELECT 1 FROM local_resource_edits e WHERE e.account_id=o.account_id AND e.change_id=o.change_id AND e.resource_id=o.entity_id)
        FROM sync_outbox o WHERE o.account_id=?2 AND o.entity_type='resource' AND o.entity_id=?1 AND o.synced_at IS NULL ORDER BY o.rowid").map_err(err)?;
    let rows=stmt.query_map(params![id,local_db::active_account(c)?],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,bool>(4)?,r.get::<_,bool>(5)?,r.get::<_,bool>(6)?))).map_err(err)?;
    let blocked=blocked_changes(c)?;
    let mut previous=None;
    for row in rows {
        let (change,owner_device,op,raw,conflict,upload,edit)=row.map_err(err)?;
        let payload:Value=serde_json::from_str(&raw).map_err(err)?;
        if conflict||blocked.contains(&change){return Err("Review the source's sync conflict before making a copy. Your saved work is preserved.".into())}
        if owner_device!=device||payload["upload"]["protocol"]!=1||!((op=="edit_content"&&edit)||(["create","create_copy"].contains(&op.as_str())&&upload)){
            return Err("Sync the source's metadata or attachment changes before copying; its revision cannot yet be verified offline.".into())
        }
        uuid::Uuid::parse_str(&change).map_err(err)?;
        previous=Some(change);
    }
    Ok(previous)
}

// An unacknowledged creation is absent from the server's visible-ID list by
// design. That exception never grants access to a previously confirmed source.
// Follow the whole copy ancestry so a derived copy cannot hide a revoked source.
pub(crate) fn require_editor_access(c:&Connection, record:&local_resources::LocalResource)->Result<(),String>{
    crate::local_resource_uploads::schema(c)?;
    crate::local_resource_posters::schema(c)?;
    let account=local_db::active_account(c)?;
    let records=local_resources::read_resources(c)?;
    let mut current=record;
    let mut visited=HashSet::new();
    loop {
        if visited.len()>=128||!visited.insert(current.id.clone()){return Err("Invalid resource copy ancestry; files are preserved".into())}
        let authored=crate::local_resource_authority::require_own_pending_creation(c,current)?;
        if !authored{crate::local_resource_attachments::require_cached_resource_editor(c,current)?;}
        let creating:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM active_sync_outbox o JOIN local_resource_uploads u ON u.account_id=o.account_id AND u.change_id=o.change_id WHERE o.entity_type='resource' AND o.entity_id=?1 AND o.operation IN ('create','create_copy') AND o.synced_at IS NULL AND u.resource_id=o.entity_id AND u.state='ready' AND u.server_revision IS NULL)",[&current.id],|r|r.get(0)).map_err(err)?;
        let denied:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_poster_denials WHERE account_id=?1 AND resource_id=?2)",params![account,current.id],|r|r.get(0)).map_err(err)?;
        if denied&&!creating{return Err("Source access revoked; authored copies and saved versions are preserved".into())}
        if !creating{return Ok(())}
        crate::local_auth::require_local_permission(c,"resources.create")?;
        let Some(source)=current.derived_from_resource_id.as_ref() else{return Ok(())};
        current=records.iter().find(|r|&r.id==source).ok_or("Source resource access unavailable; authored files are preserved")?;
    }
}

struct Intent { id:String, entity:String, previous:Option<String>, conflicted:bool }
fn pending(c:&Connection)->Result<Vec<Intent>,String>{
    let mut stmt=c.prepare("SELECT o.change_id,o.entity_id,o.payload_json,EXISTS(SELECT 1 FROM sync_conflicts f WHERE f.change_id=o.change_id AND f.resolved_at IS NULL) FROM sync_outbox o WHERE o.account_id=?1 AND o.entity_type='resource' AND o.synced_at IS NULL ORDER BY o.rowid").map_err(err)?;
    let rows=stmt.query_map([local_db::active_account(c)?],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,String>(2)?,r.get::<_,bool>(3)?))).map_err(err)?;
    rows.map(|row|{
        let (id,entity,raw,conflicted)=row.map_err(err)?;
        let payload:Value=serde_json::from_str(&raw).map_err(err)?;
        let previous=payload["copy"]["previous_change_id"].as_str().or_else(||payload["edit"]["previous_change_id"].as_str()).or_else(||payload["attachment"]["previous_change_id"].as_str()).map(str::to_owned);
        Ok(Intent{id,entity:entity.unwrap_or_default(),previous,conflicted})
    }).collect()
}

fn descendants(rows:&[Intent],mut blocked:HashSet<String>)->HashSet<String>{
    loop {
        let before=blocked.len();
        let mut entities=HashSet::new();
        for row in rows {
            if blocked.contains(&row.id)||row.previous.as_ref().is_some_and(|p|blocked.contains(p))||(!row.entity.is_empty()&&entities.contains(&row.entity)){
                blocked.insert(row.id.clone());
                if !row.entity.is_empty(){entities.insert(row.entity.clone());}
            }
        }
        if before==blocked.len(){return blocked}
    }
}

pub(crate) fn blocked_changes(c:&Connection)->Result<HashSet<String>,String>{
    let rows=pending(c)?;
    let seeds=rows.iter().filter(|r|r.conflicted).map(|r|r.id.clone()).collect();
    Ok(descendants(&rows,seeds))
}

pub(crate) fn discard_descendants(c:&Connection,change:&str,resolution:&str)->Result<(),String>{
    let account=local_db::active_account(c)?;
    let ids=descendants(&pending(c)?,HashSet::from([change.to_owned()]));
    for id in ids {
        c.execute("UPDATE sync_conflicts SET resolved_at=CURRENT_TIMESTAMP,resolution=?2 WHERE change_id=?1 AND change_id IN(SELECT change_id FROM sync_outbox WHERE account_id=?3)",params![id,resolution,account]).map_err(err)?;
        // Retire intents only; never delete authored bytes or recovery records.
        c.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP,last_error=NULL WHERE account_id=?1 AND change_id=?2 AND synced_at IS NULL",params![account,id]).map_err(err)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn intent(id:&str,entity:&str,previous:Option<&str>)->Intent{Intent{id:id.into(),entity:entity.into(),previous:previous.map(str::to_owned),conflicted:false}}
    #[test]
    fn blocks_copy_chains_and_later_mutations_but_not_independent_or_earlier_work(){
        let rows=vec![intent("early","a",None),intent("source","a",None),intent("copy","b",Some("source")),intent("edit","b",Some("copy")),intent("delete","b",None),intent("other","c",None)];
        assert_eq!(descendants(&rows,HashSet::from(["source".into()])),HashSet::from(["source".into(),"copy".into(),"edit".into(),"delete".into()]));
    }
    #[test]
    fn cycles_terminate_and_reversed_dependencies_are_not_missed(){
        let rows=vec![intent("child","b",Some("parent")),intent("parent","a",Some("child"))];
        assert_eq!(descendants(&rows,HashSet::from(["parent".into()])),HashSet::from(["child".into(),"parent".into()]));
        assert!(descendants(&rows,HashSet::new()).is_empty());
    }
}
