//! Resource editor dependencies are account-scoped, immutable outbox identities.
use std::collections::{HashMap,HashSet};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use crate::{local_db, local_resources};

fn err(e: impl std::fmt::Display) -> String { e.to_string() }

// Called while the copy writer holds its IMMEDIATE transaction. Unsupported
// metadata/attachment intents stay blocked rather than guessing their revision.
pub(crate) fn source_predecessor(c:&Connection, id:&str)->Result<Option<String>,String>{
    if let Some(record)=local_resources::read_resources(c)?.into_iter().find(|r|r.id==id){
        if let Some((_,previous))=crate::local_resource_attachments::pending_mutation_origin(c,&record)?{return Ok(Some(previous))}
    }
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
    crate::local_resource_tree_moves::require_no_pending_tree(c,&record.id)?;
    crate::local_resource_uploads::schema(c)?;
    crate::local_resource_posters::schema(c)?;
    let account=local_db::active_account(c)?;
    let records=local_resources::read_resources(c)?;
    let mut current=record;
    let mut visited=HashSet::new();
    loop {
        if visited.len()>=128||!visited.insert(current.id.clone()){return Err("Invalid resource copy ancestry; files are preserved".into())}
        let mixed=crate::local_resource_authority::require_pending_mutation_editor(c,current)?.is_some();
        let authored=if mixed{true}else{crate::local_resource_authority::require_own_pending_creation(c,current)?};
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

struct Intent { id:String, entity:String, previous:Vec<String>, conflicted:bool }
fn pending(c:&Connection)->Result<Vec<Intent>,String>{
    let mut stmt=c.prepare("SELECT o.change_id,o.entity_id,o.payload_json,EXISTS(SELECT 1 FROM sync_conflicts f WHERE f.change_id=o.change_id AND f.resolved_at IS NULL),o.operation FROM sync_outbox o WHERE o.account_id=?1 AND o.entity_type='resource' AND o.synced_at IS NULL ORDER BY o.rowid").map_err(err)?;
    let rows=stmt.query_map([local_db::active_account(c)?],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,String>(2)?,r.get::<_,bool>(3)?,r.get::<_,String>(4)?))).map_err(err)?;
    let mut creations=HashMap::new();let mut trees:HashMap<String,String>=HashMap::new();let mut intents=Vec::new();
    for row in rows{
        let (id,entity,raw,conflicted,operation)=row.map_err(err)?;
        let payload:Value=serde_json::from_str(&raw).map_err(err)?;
        let mut previous=payload["copy"]["previous_change_id"].as_str().or_else(||payload["edit"]["previous_change_id"].as_str()).or_else(||payload["attachment"]["previous_change_id"].as_str()).or_else(||payload["metadata"]["previous_change_id"].as_str()).map(str::to_owned).into_iter().collect::<Vec<_>>();
        // A folder child can depend on both its own earlier intent and a native
        // parent creation. Derive these edges without rewriting saved payloads.
        let record=payload.get("resource").or_else(||payload.get("record")).unwrap_or(&payload);
        for reference in [record["parent_resource_id"].as_str(),payload["copy"]["source_id"].as_str()].into_iter().flatten(){if let Some(prior)=creations.get(reference){if !previous.contains(prior){previous.push(prior.clone());}}}
        let entity=entity.unwrap_or_default();
        for reference in [Some(entity.as_str()),record["parent_resource_id"].as_str(),payload["copy"]["source_id"].as_str()].into_iter().flatten(){if let Some(prior)=trees.get(reference){if !previous.contains(prior){previous.push(prior.clone());}}}
        if operation=="move_tree"{if let Some(members)=payload["tree_move"]["members"].as_array(){for member in members{if let Some(member)=member["id"].as_str(){trees.insert(member.into(),id.clone());}}}}

        if ["create","create_copy"].contains(&operation.as_str())&&!entity.is_empty(){creations.insert(entity.clone(),id.clone());}
        intents.push(Intent{id,entity,previous,conflicted});
    }Ok(intents)
}

fn descendants(rows:&[Intent],mut blocked:HashSet<String>)->HashSet<String>{
    loop {
        let before=blocked.len();
        let mut entities=HashSet::new();
        for row in rows {
            if blocked.contains(&row.id)||row.previous.iter().any(|p|blocked.contains(p))||(!row.entity.is_empty()&&entities.contains(&row.entity)){
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
    if c.is_autocommit(){return Err("Resource recovery retirement requires a transaction".into())}
    let account=local_db::active_account(c)?;
    let ids=descendants(&pending(c)?,HashSet::from([change.to_owned()]));
    // Archive the connected intention identities before any retirement. Original
    // immutable payloads, upload/edit provenance and authored bytes remain intact.
    c.execute_batch("CREATE TABLE IF NOT EXISTS local_resource_recoveries(account_id TEXT NOT NULL,root_change_id TEXT NOT NULL,resolution TEXT NOT NULL,change_ids_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account_id,root_change_id));").map_err(err)?;
    let prior:Option<String>=c.query_row("SELECT change_ids_json FROM local_resource_recoveries WHERE account_id=?1 AND root_change_id=?2",params![account,change],|r|r.get(0)).optional().map_err(err)?;
    let mut archived=ids.clone();if let Some(prior)=prior{archived.extend(serde_json::from_str::<Vec<String>>(&prior).map_err(|_|"Existing resource recovery evidence is unreadable; nothing was retired")?);}
    let mut archived=archived.into_iter().collect::<Vec<_>>();archived.sort();
    c.execute("INSERT INTO local_resource_recoveries(account_id,root_change_id,resolution,change_ids_json) VALUES(?1,?2,?3,?4) ON CONFLICT(account_id,root_change_id) DO UPDATE SET change_ids_json=excluded.change_ids_json",params![account,change,resolution,serde_json::to_string(&archived).map_err(err)?]).map_err(err)?;
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
    fn intent(id:&str,entity:&str,previous:Option<&str>)->Intent{Intent{id:id.into(),entity:entity.into(),previous:previous.map(str::to_owned).into_iter().collect(),conflicted:false}}
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
    #[test]
    fn folder_ancestry_and_copy_recovery_survive_restart_and_archive_failure(){
        let path=std::env::temp_dir().join(format!("labos-resource-dependencies-{}.sqlite",uuid::Uuid::new_v4()));
        let account="10000000-0000-4000-8000-000000000001";let other="10000000-0000-4000-8000-000000000002";
        let mut c=Connection::open(&path).unwrap();local_db::ensure_schema(&c).unwrap();
        c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,role TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);").unwrap();
        for(id,central)in [("a",account),("b",other)]{c.execute("INSERT INTO local_users VALUES(?1,?2,'researcher',1,datetime('now','+24 hours'),'[\"resources.view\",\"resources.edit\"]')",params![id,central]).unwrap();}
        c.execute("INSERT INTO local_session VALUES(1,'a')",[]).unwrap();
        let rows=[("earlier","historical-copy","create_copy",serde_json::json!({"copy":{"source_id":"folder"}})),("root","folder","create",serde_json::json!({"kind":"folder"})),("nested","nested-folder","create",serde_json::json!({"resource":{"parent_resource_id":"folder"}})),("child","file","create",serde_json::json!({"resource":{"parent_resource_id":"nested-folder"}})),("copy","copy-file","create_copy",serde_json::json!({"copy":{"source_id":"file"},"resource":{"parent_resource_id":"folder"}})),("edit","copy-file","edit_content",serde_json::json!({"edit":{"previous_change_id":"copy"}})),("other","unrelated","create",serde_json::json!({}))];
        for(id,entity,operation,payload)in &rows{c.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,'device','resource',?2,?3,?4)",params![id,entity,operation,payload.to_string()]).unwrap();}
        c.execute("INSERT INTO sync_conflicts(change_id,entity_type,entity_id,operation,payload_json,error_code,error_message) SELECT change_id,entity_type,entity_id,operation,payload_json,'DENIED','fixture' FROM sync_outbox WHERE change_id='root'",[]).unwrap();
        c.execute("UPDATE local_session SET user_id='b'",[]).unwrap();c.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES('foreign','device','resource','foreign-file','create','{\"resource\":{\"parent_resource_id\":\"folder\"}}')",[]).unwrap();c.execute("UPDATE local_session SET user_id='a'",[]).unwrap();
        let expected=HashSet::from(["root".into(),"nested".into(),"child".into(),"copy".into(),"edit".into()]);assert_eq!(blocked_changes(&c).unwrap(),expected);
        assert!(discard_descendants(&c,"root","accept_server").is_err());
        c.execute_batch("CREATE TABLE local_resource_recoveries(account_id TEXT NOT NULL,root_change_id TEXT NOT NULL,resolution TEXT NOT NULL,change_ids_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account_id,root_change_id));CREATE TRIGGER fail_resource_recovery BEFORE INSERT ON local_resource_recoveries BEGIN SELECT RAISE(ABORT,'archive failed'); END;").unwrap();
        {let tx=c.transaction().unwrap();assert!(discard_descendants(&tx,"root","accept_server").is_err());}
        assert_eq!(c.query_row("SELECT count(*) FROM sync_outbox WHERE synced_at IS NOT NULL",[],|r|r.get::<_,i64>(0)).unwrap(),0);assert_eq!(blocked_changes(&c).unwrap(),expected);
        c.execute_batch("DROP TRIGGER fail_resource_recovery;").unwrap();
        {let tx=c.transaction().unwrap();discard_descendants(&tx,"root","accept_server").unwrap();tx.commit().unwrap();}
        drop(c);let mut c=Connection::open(&path).unwrap();let archived:String=c.query_row("SELECT change_ids_json FROM local_resource_recoveries WHERE account_id=?1 AND root_change_id='root'",[account],|r|r.get(0)).unwrap();assert_eq!(serde_json::from_str::<Vec<String>>(&archived).unwrap().into_iter().collect::<HashSet<_>>(),expected);
        assert_eq!(c.query_row("SELECT count(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),8);assert_eq!(c.query_row("SELECT count(*) FROM sync_outbox WHERE synced_at IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),3);assert!(blocked_changes(&c).unwrap().is_empty());
        for(id,_,_,payload)in rows{let raw:String=c.query_row("SELECT payload_json FROM sync_outbox WHERE change_id=?1",[id],|r|r.get(0)).unwrap();assert_eq!(serde_json::from_str::<Value>(&raw).unwrap(),payload);}
        // Explicitly revisiting a root later must extend its recovery index,
        // never hide newer retired descendants behind an older archive entry.
        c.execute("UPDATE sync_outbox SET synced_at=NULL WHERE change_id='root'",[]).unwrap();c.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES('later-child','device','resource','later-file','create','{\"resource\":{\"parent_resource_id\":\"folder\"}}')",[]).unwrap();
        {let tx=c.transaction().unwrap();discard_descendants(&tx,"root","dismiss").unwrap();tx.commit().unwrap();}
        let raw:String=c.query_row("SELECT change_ids_json FROM local_resource_recoveries WHERE account_id=?1 AND root_change_id='root'",[account],|r|r.get(0)).unwrap();let archived=serde_json::from_str::<Vec<String>>(&raw).unwrap().into_iter().collect::<HashSet<_>>();assert_eq!(archived.len(),6);assert!(archived.contains("later-child"));assert!(expected.is_subset(&archived));
        c.execute("UPDATE sync_outbox SET synced_at=NULL WHERE change_id='root'",[]).unwrap();c.execute("UPDATE local_resource_recoveries SET change_ids_json='corrupt' WHERE account_id=?1",[account]).unwrap();
        {let tx=c.transaction().unwrap();assert!(discard_descendants(&tx,"root","dismiss").is_err());}
        assert_eq!(c.query_row("SELECT count(*) FROM sync_outbox WHERE change_id='root' AND synced_at IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(c);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn rejected_tree_retirement_archives_later_member_edits_and_source_copies_atomically(){
        use crate::local_resource_recovery::tests::{fixture,ACCOUNT};let(mut c,path)=fixture();let device:String=c.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).unwrap();
        for(change,entity,operation,payload)in [("tree-review","root","move_tree",serde_json::json!({"id":"root","tree_move":{"members":[{"id":"root"},{"id":"child"}]}})),("child-edit","child","edit_metadata",serde_json::json!({"id":"child","metadata":{"fields":{"description":"preserved"}}})),("child-copy","copy","create_copy",serde_json::json!({"copy":{"source_id":"child"}})),("independent","other","edit_metadata",serde_json::json!({"id":"other"}))]{c.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'resource',?3,?4,?5)",params![change,device,entity,operation,payload.to_string()]).unwrap();}
        let tx=c.transaction().unwrap();discard_descendants(&tx,"tree-review","dismiss").unwrap();tx.commit().unwrap();let archived:String=c.query_row("SELECT change_ids_json FROM local_resource_recoveries WHERE account_id=?1",[ACCOUNT],|r|r.get(0)).unwrap();let ids:Vec<String>=serde_json::from_str(&archived).unwrap();assert_eq!(ids.len(),3);assert!(ids.contains(&"child-copy".into()));assert_eq!(c.query_row("SELECT count(*) FROM sync_outbox WHERE synced_at IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),1);drop(c);std::fs::remove_file(path).unwrap();
    }

}
