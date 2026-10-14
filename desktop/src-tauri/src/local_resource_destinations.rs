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
    c.execute_batch("CREATE TABLE IF NOT EXISTS local_resource_destinations(account_id TEXT NOT NULL,kind TEXT NOT NULL,entity_id TEXT NOT NULL,origin TEXT NOT NULL,scope_json TEXT,can_attach INTEGER NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(account_id,kind,entity_id));").map_err(err)
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
