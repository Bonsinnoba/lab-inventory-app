//! Destination decisions come from native server verification, not UI grants.
use crate::{local_auth,local_db,local_resource_authority,native_authorization};
use rusqlite::{params,Connection,OptionalExtension,TransactionBehavior};
use serde::{Deserialize,Serialize};
use serde_json::Value;
use std::collections::HashSet;
use tauri::AppHandle;

#[derive(Clone,Debug,Deserialize,Serialize,PartialEq,Eq,Hash)]
#[serde(deny_unknown_fields)]
struct Destination {kind:String,id:String}
#[derive(Debug,Deserialize,Serialize,PartialEq)]
#[serde(deny_unknown_fields)]
struct Scope {project_id:Option<String>,visibility:String}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Grant {kind:String,id:String,can_attach:bool,scope:Option<Scope>}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {protocol:u32,account_id:String,grants:Vec<Grant>}
fn err(e:impl std::fmt::Display)->String{e.to_string()}
fn schema(c:&Connection)->Result<(),String>{
    c.execute_batch("CREATE TABLE IF NOT EXISTS local_resource_destinations(account_id TEXT NOT NULL,kind TEXT NOT NULL,entity_id TEXT NOT NULL,origin TEXT NOT NULL,scope_json TEXT,can_attach INTEGER NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(account_id,kind,entity_id));
    CREATE TABLE IF NOT EXISTS local_native_destinations(account_id TEXT NOT NULL,kind TEXT NOT NULL,entity_id TEXT NOT NULL,change_id TEXT NOT NULL,device_id TEXT NOT NULL,payload_json TEXT NOT NULL,scope_json TEXT NOT NULL,PRIMARY KEY(account_id,kind,entity_id));").map_err(err)
}

// Populated only by native project/note creation, in its projection/outbox
// transaction. Cache pulls and renderer-supplied grant snapshots cannot write it.
pub(crate) fn record_creation(c:&Connection,kind:&str,id:&str,change:&str,payload:&Value)->Result<(),String>{
    if c.is_autocommit()||!["project","note"].contains(&kind){return Err("Native destination provenance requires its creation transaction".into())}schema(c)?;
    if payload["id"].as_str()!=Some(id){return Err("Native destination identity mismatch".into())}
    let account=local_db::active_account(c)?;let device:String=c.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(err)?;
    c.execute("INSERT INTO local_native_destinations(account_id,kind,entity_id,change_id,device_id,payload_json,scope_json) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![account,kind,id,change,device,payload.to_string(),serde_json::to_string(&scope(kind,payload)).map_err(err)?]).map_err(err)?;Ok(())
}

fn own_pending(c:&Connection,kind:&str,id:&str)->Result<Option<String>,String>{
    schema(c)?;let account=local_db::active_account(c)?;
    let proof:Option<(String,String)>=c.query_row("SELECT n.change_id,n.scope_json FROM local_native_destinations n JOIN sync_outbox o ON o.account_id=n.account_id AND o.change_id=n.change_id AND o.entity_type=n.kind AND o.entity_id=n.entity_id AND o.operation='create' AND o.device_id=n.device_id AND o.payload_json=n.payload_json WHERE n.account_id=?1 AND n.kind=?2 AND n.entity_id=?3 AND n.device_id=(SELECT device_id FROM device_identity WHERE id=1) AND o.synced_at IS NULL",params![account,kind,id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(err)?;
    let Some((change,raw))=proof else{return Ok(None)};
    let blocked:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM sync_outbox o WHERE o.account_id=?1 AND o.entity_type=?2 AND o.entity_id=?3 AND o.synced_at IS NULL AND (o.operation='delete' OR EXISTS(SELECT 1 FROM sync_conflicts f WHERE f.change_id=o.change_id AND f.resolved_at IS NULL)))",params![account,kind,id],|r|r.get(0)).map_err(err)?;
    if blocked{return Err("Review the destination's pending deletion or sync conflict before attaching".into())}
    for suffix in ["view","edit","create"]{local_auth::require_local_permission(c,&format!("{}.{suffix}",if kind=="project"{"projects"}else{"notes"}))?;}
    let records=rows(c,kind)?;let mut found=records.iter().filter(|r|r["id"].as_str()==Some(id));let current=found.next().ok_or("Native destination no longer exists locally")?;
    let original:Scope=serde_json::from_str(&raw).map_err(err)?;
    if found.next().is_some()||scope(kind,current)!=original{return Err("Native destination scope changed; synchronize and review before attaching".into())}
    if kind=="project"{if current["owner_id"].as_str()!=Some(account.as_str()){return Err("Native project ownership changed".into())}crate::local_projects::require_cached_project_access(c,id,true)?;}
    else if let Some(project)=&original.project_id{require_destination(c,"project",project)?;}
    Ok(Some(change))
}

pub(crate) fn dependencies(c:&Connection,record:&Value)->Result<Vec<Value>,String>{
    let mut dependencies=Vec::new();for (field,kind) in [("project_id","project"),("note_id","note")]{if let Some(id)=record[field].as_str(){if let Some(change)=own_pending(c,kind,id)?{dependencies.push(serde_json::json!({"change_id":change,"entity_type":kind,"entity_id":id}));}}}Ok(dependencies)
}
fn rows(c:&Connection,kind:&str)->Result<Vec<Value>,String>{
    match kind{"note"=>crate::local_notes::load(c),"project"=>crate::local_projects::load_all(c),_=>Err("Invalid resource destination kind".into())}
}
fn scope(kind:&str,row:&Value)->Scope{
    Scope{project_id:row[if kind=="project"{"id"}else{"project_id"}].as_str().map(str::to_owned),visibility:row["visibility"].as_str().unwrap_or("lab").into()}
}
fn validate(snapshot:&Snapshot,account:&str,requested:&[Destination])->Result<(),String>{
    if snapshot.protocol!=1||snapshot.account_id!=account||snapshot.grants.len()!=requested.len(){return Err("Destination authority identity or completeness mismatch".into())}
    let mut seen=HashSet::new();
    for grant in &snapshot.grants{
        let destination=Destination{kind:grant.kind.clone(),id:grant.id.clone()};
        if !requested.contains(&destination)||!seen.insert(destination){return Err("Unexpected or duplicate destination authority".into())}
        if grant.can_attach{
            let scope=grant.scope.as_ref().ok_or("Missing destination scope")?;
            if !["lab","project","restricted"].contains(&scope.visibility.as_str())||(grant.kind=="project"&&scope.project_id.as_deref()!=Some(grant.id.as_str())){return Err("Invalid destination scope".into())}
            if let Some(id)=&scope.project_id{if uuid::Uuid::parse_str(id).map_err(err)?.to_string()!=*id{return Err("Invalid destination project identity".into())}}
        }else if grant.scope.is_some(){return Err("Denied destination must not disclose scope".into())}
    }Ok(())
}

// Called under the resource refresh serialization guard. No renderer IDs, origin,
// positive decisions or lease values are accepted as command arguments.
pub(crate) async fn refresh(app:&AppHandle,account:&str,session:&str,token:&str,lease:&str)->Result<usize,String>{
    let destinations={
        let c=local_db::open_local_connection(app)?;schema(&c)?;
        if local_resource_authority::guard(&c,account,session)?!=lease{return Err("Destination authorization lease changed".into())}
        let mut destinations=Vec::new();let mut seen=HashSet::new();
        for kind in ["note","project"]{
            for row in rows(&c,kind)?{
                let id=row["id"].as_str().ok_or("Missing destination identity")?;
                if uuid::Uuid::parse_str(id).map_err(err)?.to_string()!=id{return Err("Destination identity needs reconciliation".into())}
                let value=Destination{kind:kind.into(),id:id.into()};
                if !seen.insert(value.clone()){return Err("Duplicate local destination identity".into())}destinations.push(value);
            }
        }
        let mut stmt=c.prepare("SELECT kind,entity_id FROM local_resource_destinations WHERE account_id=?1").map_err(err)?;
        for value in stmt.query_map([account],|r|Ok(Destination{kind:r.get(0)?,id:r.get(1)?})).map_err(err)?{
            let value=value.map_err(err)?;if seen.insert(value.clone()){destinations.push(value)}
        }destinations
    };
    let origin=native_authorization::trusted_base().map_err(|e|e.message)?;
    let client=native_authorization::client().map_err(|e|e.message)?;
    let mut count=0;
    for batch in destinations.chunks(25){
        {let c=local_db::open_local_connection(app)?;if local_resource_authority::guard(&c,account,session)?!=lease{return Err("Destination authorization lease changed".into())}}
        let response=client.post(format!("{origin}/sync/resources/destination-authority")).bearer_auth(token).json(&serde_json::json!({"destinations":batch})).send().await.map_err(|_|"Destination authority server unavailable; existing lease-bounded cache is unchanged")?;
        let snapshot:Snapshot=match native_authorization::response_json(response).await{
            Ok(value)=>value,
            Err(error)=>{
                if error.code=="AUTH_REVOKED"{let mut c=local_db::open_local_connection(app)?;local_auth::invalidate_authorization(&mut c,account,session)?;}
                return Err(format!("{}: {}",error.code,error.message));
            }
        };
        validate(&snapshot,account,batch)?;
        let mut c=local_db::open_local_connection(app)?;schema(&c)?;
        let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;
        if local_resource_authority::guard(&tx,account,session)?!=lease{return Err("Destination authorization lease changed".into())}
        for grant in snapshot.grants{
            let raw=grant.scope.map(|s|serde_json::to_string(&s)).transpose().map_err(err)?;
            tx.execute("INSERT INTO local_resource_destinations(account_id,kind,entity_id,origin,scope_json,can_attach,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(account_id,kind,entity_id) DO UPDATE SET origin=excluded.origin,scope_json=excluded.scope_json,can_attach=excluded.can_attach,expires_at=excluded.expires_at",params![account,grant.kind,grant.id,origin,raw,grant.can_attach,lease]).map_err(err)?;
            count+=1;
        }tx.commit().map_err(err)?;
    }Ok(count)
}

pub(crate) fn require_destination(c:&Connection,kind:&str,id:&str)->Result<(),String>{
    if own_pending(c,kind,id)?.is_some(){return Ok(())}
    schema(c)?;let account=local_db::active_account(c)?;
    let origin=native_authorization::trusted_base().map_err(|e|e.message)?;
    let grant:Option<(bool,Option<String>)>=c.query_row("SELECT can_attach,scope_json FROM local_resource_destinations WHERE account_id=?1 AND kind=?2 AND entity_id=?3 AND origin=?4 AND datetime('now')<datetime(expires_at) AND expires_at=(SELECT u.offline_expires_at FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1)",params![account,kind,id,origin],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(err)?;
    let (allowed,raw)=grant.ok_or("Destination authority is not cached or expired. Connect once to verify access; saved work is preserved")?;
    if !allowed{return Err("This account cannot attach resources to that destination".into())}
    let verified:Scope=serde_json::from_str(&raw.ok_or("Destination scope missing")?).map_err(err)?;
    let rows=rows(c,kind)?;let mut matching=rows.iter().filter(|r|r["id"].as_str()==Some(id));
    let row=matching.next().ok_or("Destination unavailable on this PC")?;
    if matching.next().is_some()||scope(kind,row)!=verified{return Err("Destination scope changed; reconnect to verify access before attaching".into())}
    Ok(())
}

#[cfg(test)]
mod tests{
    use super::*;
    const ID:&str="11111111-1111-4111-8111-111111111111";
    #[test]
    fn own_unsynced_destination_needs_native_provenance_current_scope_rights_and_no_conflict(){
        let path=std::env::temp_dir().join(format!("labos-native-destination-{}.sqlite",uuid::Uuid::new_v4()));let account="10000000-0000-4000-8000-000000000001";let change="22222222-2222-4222-8222-222222222222";
        let mut c=Connection::open(&path).unwrap();local_db::ensure_schema(&c).unwrap();schema(&c).unwrap();
        c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,role TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);INSERT INTO local_users VALUES('a','10000000-0000-4000-8000-000000000001','researcher',1,datetime('now','+1 hour'),'[\"notes.view\",\"notes.edit\",\"notes.create\"]');INSERT INTO local_users VALUES('b','10000000-0000-4000-8000-000000000002','researcher',1,datetime('now','+1 hour'),'[\"notes.view\",\"notes.edit\",\"notes.create\"]');INSERT INTO local_session VALUES(1,'a');").unwrap();
        let note=serde_json::json!({"id":ID,"title":"New offline note","visibility":"restricted","project_id":null,"author_id":account});let device:String=c.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).unwrap();let key=local_db::scoped_state_key(&c,"notes_state").unwrap();
        c.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2)",params![key,serde_json::json!([note]).to_string()]).unwrap();c.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'note',?3,'create',?4)",params![change,device,ID,note.to_string()]).unwrap();
        assert!(own_pending(&c,"note",ID).unwrap().is_none());assert!(record_creation(&c,"note",ID,change,&note).is_err());
        {let tx=c.transaction().unwrap();record_creation(&tx,"note",ID,change,&note).unwrap();tx.commit().unwrap();}drop(c);
        let c=Connection::open(&path).unwrap();assert_eq!(own_pending(&c,"note",ID).unwrap().as_deref(),Some(change));require_destination(&c,"note",ID).unwrap();
        assert_eq!(dependencies(&c,&serde_json::json!({"note_id":ID})).unwrap(),vec![serde_json::json!({"change_id":change,"entity_type":"note","entity_id":ID})]);
        let mut altered=note.clone();altered["visibility"]=serde_json::json!("lab");c.execute("UPDATE sync_state SET value=?2 WHERE key=?1",params![key,serde_json::json!([altered]).to_string()]).unwrap();assert!(own_pending(&c,"note",ID).is_err());c.execute("UPDATE sync_state SET value=?2 WHERE key=?1",params![key,serde_json::json!([note]).to_string()]).unwrap();
        c.execute("UPDATE local_users SET permissions_json='[]' WHERE id='a'",[]).unwrap();assert!(own_pending(&c,"note",ID).is_err());c.execute("UPDATE local_users SET permissions_json='[\"notes.view\",\"notes.edit\",\"notes.create\"]' WHERE id='a'",[]).unwrap();
        c.execute("UPDATE local_session SET user_id='b'",[]).unwrap();assert!(own_pending(&c,"note",ID).unwrap().is_none());c.execute("UPDATE local_session SET user_id='a'",[]).unwrap();
        c.execute("INSERT INTO sync_conflicts(change_id,entity_type,entity_id,operation,payload_json,error_code,error_message) VALUES(?1,'note',?2,'create',?3,'DENIED','fixture')",params![change,ID,note.to_string()]).unwrap();assert!(own_pending(&c,"note",ID).is_err());
        drop(c);std::fs::remove_file(path).unwrap();
    }
    fn request()->Vec<Destination>{vec![Destination{kind:"note".into(),id:ID.into()}]}
    fn snapshot()->Snapshot{Snapshot{protocol:1,account_id:"account".into(),grants:vec![Grant{kind:"note".into(),id:ID.into(),can_attach:true,scope:Some(Scope{project_id:None,visibility:"restricted".into()})}]}}
    #[test]
    fn destination_snapshots_require_account_identity_kind_and_completeness(){
        validate(&snapshot(),"account",&request()).unwrap();
        assert!(validate(&snapshot(),"other",&request()).is_err());
        assert!(validate(&snapshot(),"account",&[]).is_err());
        let mut s=snapshot();s.grants[0].kind="project".into();assert!(validate(&s,"account",&request()).is_err());
        let mut s=snapshot();s.grants.push(snapshot().grants.remove(0));let mut requests=request();requests.push(Destination{kind:"project".into(),id:ID.into()});assert!(validate(&s,"account",&requests).is_err());
    }
    #[test]
    fn denied_or_incomplete_scope_never_becomes_positive_authority(){
        let mut s=snapshot();s.grants[0].scope=None;assert!(validate(&s,"account",&request()).is_err());
        s.grants[0].can_attach=false;validate(&s,"account",&request()).unwrap();
        let mut s=snapshot();s.grants[0].can_attach=false;assert!(validate(&s,"account",&request()).is_err());
        let mut s=snapshot();s.grants[0].scope.as_mut().unwrap().project_id=Some("bad".into());assert!(validate(&s,"account",&request()).is_err());
        let mut s=snapshot();s.grants[0].kind="project".into();assert!(validate(&s,"account",&[Destination{kind:"project".into(),id:ID.into()}]).is_err());
    }
    #[test]
    fn destination_scope_changes_are_distinct_from_content_changes(){
        let row=serde_json::json!({"id":ID,"visibility":"restricted","project_id":null,"body":"one"});
        let mut changed=row.clone();changed["body"]=serde_json::json!("two");assert_eq!(scope("note",&row),scope("note",&changed));
        changed["project_id"]=serde_json::json!(ID);assert_ne!(scope("note",&row),scope("note",&changed));
        changed=row.clone();changed["visibility"]=serde_json::json!("lab");assert_ne!(scope("note",&row),scope("note",&changed));
        assert_eq!(scope("project",&row).project_id.as_deref(),Some(ID));
    }
}
