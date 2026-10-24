use rusqlite::{params,Connection};
use serde_json::{json,Value};
use crate::{local_db,local_projects,inventory_sync_state::canonical_id};

#[derive(serde::Deserialize)]
pub struct ReviewIntentInput {pub expected_account_id:String,pub change_id:String,pub project_id:String,pub decision:String,pub note:String}

pub(crate) fn project(c:&Connection,p:&mut Value)->Result<(),String>{
    let account=local_db::active_account(c)?;
    let mut q=c.prepare("SELECT o.change_id,o.payload_json,o.synced_at,o.last_error,c.error_message FROM sync_outbox o LEFT JOIN sync_conflicts c ON c.change_id=o.change_id AND c.resolved_at IS NULL WHERE o.entity_type='project_review' AND o.entity_id=?1 AND o.account_id=?2 AND NOT EXISTS(SELECT 1 FROM sync_conflicts d WHERE d.change_id=o.change_id AND d.resolved_at IS NOT NULL AND d.resolution IN ('accept_server','dismiss')) ORDER BY o.rowid").map_err(|e|e.to_string())?;
    let rows=q.query_map(params![p["id"].as_str(),account],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,Option<String>>(4)?))).map_err(|e|e.to_string())?;
    let mut pending=Vec::new();
    for row in rows{
        let (id,raw,synced,error,conflict)=row.map_err(|e|e.to_string())?;
        let payload:Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
        if synced.is_some()&&payload["expected_token"]!=p["review_snapshot"]["token"]{continue;}
        pending.push(json!({"change_id":id,"decision":payload["decision"],"note":payload["note"],"state":if conflict.is_some(){"rejected"}else if synced.is_some(){"awaiting_snapshot"}else{"pending"},"error":conflict.or(error)}));
    }
    p["local_review_pending"]=json!(!pending.is_empty());
    if p["review_snapshot"].is_object(){p["review_snapshot"]["pending_intents"]=json!(pending);}
    Ok(())
}

pub(crate) fn require_authority(c:&Connection,project_id:&str,decision:&str)->Result<(),String>{
    local_projects::require_cached_project_access(c,project_id,true)?;
    let account=local_db::active_account(c)?;
    let role:String=c.query_row("SELECT u.role FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    let p=local_projects::load_all(c)?.into_iter().find(|p|p["id"]==project_id).ok_or("Project not cached")?;
    if role!="admin"&&(decision!="submit"||(p["owner_id"]!=account&&p.pointer("/permissions/member_role").and_then(Value::as_str)!=Some("lead"))){return Err("Project lead/admin required to submit; administrator required for review".into());}
    Ok(())
}

#[tauri::command]
pub fn save_local_project_review_intent(app:tauri::AppHandle,input:ReviewIntentInput)->Result<Value,String>{
    let mut c=local_db::open_local_connection(&app)?;save(&mut c,input)
}
pub(crate) fn save(c:&mut Connection,input:ReviewIntentInput)->Result<Value,String>{
    let id=canonical_id(&input.project_id)?;let change=canonical_id(&input.change_id)?;
    if !["submit","approve","request_changes"].contains(&input.decision.as_str())||input.note.encode_utf16().count()>2000||(input.decision=="request_changes"&&input.note.trim().is_empty()){return Err("Invalid review decision or note".into());}
    let tx=c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    local_db::require_sync_account(&tx,&input.expected_account_id)?;
    require_authority(&tx,&id,&input.decision)?;
    let mut p=local_projects::load_all(&tx)?.into_iter().find(|p|p["id"]==id).ok_or("Project not cached")?;
    project(&tx,&mut p)?;
    if p["local_review_pending"]==true{return Err("Review already awaits synchronization or conflict resolution".into());}
    let snapshot=&p["review_snapshot"];
    let token=snapshot["token"].as_str().filter(|s|!s.is_empty()).ok_or("Synchronize a current review snapshot first")?;
    let state=snapshot["project"]["review_status"].as_str().unwrap_or("");
    if snapshot["project"]["id"]!=id||p["status"]!="planning"||snapshot["project"]["status"]!="planning"||
       (input.decision=="submit"&&!matches!(state,"draft"|"changes_requested"))||(input.decision!="submit"&&state!="submitted"){return Err("Review state does not permit this decision".into());}
    // A locally changed plan must synchronize before its review can be authored.
    let dirty:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE account_id=?1 AND synced_at IS NULL AND (entity_id=?2 OR json_extract(payload_json,'$.project_id')=?2 OR json_extract(payload_json,'$.record.project_id')=?2))",params![input.expected_account_id,id],|r|r.get(0)).map_err(|e|e.to_string())?;
    if dirty{return Err("Synchronize pending project work before authoring a review decision".into());}
    let payload=json!({"project_id":id,"expected_token":token,"decision":input.decision,"note":input.note.trim()});
    let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'project_review',?3,'decision',?4)",params![change,device,id,payload.to_string()]).map_err(|e|e.to_string())?;
    project(&tx,&mut p)?;tx.commit().map_err(|e|e.to_string())?;Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    const PID:&str="11111111-1111-4111-8111-111111111111";
    const CID:&str="22222222-2222-4222-8222-222222222222";
    fn fixture()->Connection {
        let c=Connection::open_in_memory().unwrap();local_db::ensure_schema(&c).unwrap();
        c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT,role TEXT); CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT); INSERT INTO local_users VALUES('local','account',1,'2099-01-01','[\"projects.view\",\"projects.edit\"]','admin'); INSERT INTO local_session VALUES(1,'local');").unwrap();
        let p=json!({"id":PID,"status":"planning","owner_id":"account","permissions":{"user_id":"account","access":"admin","can_edit":true},"review_snapshot":{"token":"v1","project":{"id":PID,"status":"planning","review_status":"submitted"},"events":[]}});
        c.execute("INSERT INTO sync_state(key,value) VALUES('account:account:projects_state',?1)",[json!([p]).to_string()]).unwrap();c
    }
    fn input()->ReviewIntentInput {ReviewIntentInput{expected_account_id:"account".into(),change_id:CID.into(),project_id:PID.into(),decision:"approve".into(),note:"Keep this authored note".into()}}
    fn cached(c:&Connection)->Value {local_projects::load_all(c).unwrap().remove(0)}
    #[test]
    fn queues_owned_intent_without_activating_and_prevents_double_submission(){
        let mut c=fixture();let original=cached(&c);let result=save(&mut c,input()).unwrap();
        assert_eq!(result["status"],"planning");assert_eq!(result["review_snapshot"]["project"]["review_status"],"submitted");
        assert_eq!(result["review_snapshot"]["pending_intents"][0]["state"],"pending");assert_eq!(cached(&c),original);
        let (account,raw):(String,String)=c.query_row("SELECT account_id,payload_json FROM sync_outbox WHERE change_id=?1",[CID],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(account,"account");assert_eq!(serde_json::from_str::<Value>(&raw).unwrap()["expected_token"],"v1");
        assert!(save(&mut c,input()).is_err());
        assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
    #[test]
    fn ack_waits_for_snapshot_and_conflict_note_is_preserved(){
        let mut c=fixture();save(&mut c,input()).unwrap();
        c.execute("INSERT INTO sync_conflicts(change_id,entity_type,operation,payload_json,error_code,error_message) VALUES(?1,'project_review','decision','{}','REVIEW_VERSION_CONFLICT','Project changed')",[CID]).unwrap();
        let mut p=cached(&c);project(&c,&mut p).unwrap();assert_eq!(p["review_snapshot"]["pending_intents"][0]["state"],"rejected");
        assert_eq!(p["review_snapshot"]["pending_intents"][0]["note"],"Keep this authored note");
        c.execute("UPDATE sync_conflicts SET resolved_at=CURRENT_TIMESTAMP,resolution='keep_local'",[]).unwrap();
        c.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP",[]).unwrap();
        project(&c,&mut p).unwrap();assert_eq!(p["review_snapshot"]["pending_intents"][0]["state"],"awaiting_snapshot");
        p["review_snapshot"]["token"]=json!("v2");project(&c,&mut p).unwrap();assert_eq!(p["local_review_pending"],false);
        p["review_snapshot"]["token"]=json!("v1");c.execute("UPDATE sync_conflicts SET resolution='dismiss'",[]).unwrap();
        project(&c,&mut p).unwrap();assert_eq!(p["local_review_pending"],false);
        assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
    #[test]
    fn expired_foreign_and_nonadmin_approval_cannot_write(){
        let mut c=fixture();let mut i=input();i.expected_account_id="foreign".into();assert!(save(&mut c,i).is_err());
        c.execute("UPDATE local_users SET role='member'",[]).unwrap();assert!(save(&mut c,input()).is_err());
        c.execute("UPDATE local_users SET role='admin',offline_expires_at='2000-01-01'",[]).unwrap();assert!(save(&mut c,input()).is_err());
        assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }
    #[test]
    fn failed_outbox_insert_leaves_project_untouched(){
        let mut c=fixture();let before=cached(&c);
        c.execute_batch("CREATE TRIGGER fail_review BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'disk probe'); END;").unwrap();
        assert!(save(&mut c,input()).is_err());assert_eq!(cached(&c),before);
        assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }
}
