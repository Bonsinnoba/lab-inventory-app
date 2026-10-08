use rusqlite::{params,Connection,OptionalExtension,TransactionBehavior};
use serde_json::{json,Value};
use tauri::AppHandle;
use crate::local_db;

const KEY:&str="daily_use_preferences";
fn read(c:&Connection)->Result<Value,String>{
    let raw:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(c,KEY)?],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    let mut value=match raw{Some(s)=>serde_json::from_str::<Value>(&s).map_err(|e|format!("Invalid daily preferences: {e}"))?,None=>json!({})};
    let o=value.as_object_mut().ok_or("Stored preferences must be an object")?;
    // Existing per-account installation values are retained, never adopted from
    // another account or copied to another device.
    for (key,default) in [("notifications_enabled",json!(true)),("auto_pause_music",json!(false)),("music_volume",json!(0.7)),("sync_version",json!(0)),("updated_at",Value::Null)]{
        o.entry(key.to_string()).or_insert(default);
    }
    let pending:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM active_sync_outbox WHERE entity_type='daily_preferences' AND synced_at IS NULL)",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    value["pending_sync"]=json!(pending);Ok(value)
}
fn write(c:&Connection,value:&Value)->Result<(),String>{
    c.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![local_db::scoped_state_key(c,KEY)?,value.to_string()]).map_err(|e|e.to_string())?;Ok(())
}
fn update(c:&mut Connection,account:&str,preferences:Value,change_id:&str)->Result<Value,String>{
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    local_db::require_sync_account(&tx,account)?;
    let mut current=read(&tx)?;
    let incoming=preferences.as_object().ok_or("Preferences must be an object")?;
    for key in incoming.keys(){if !["notifications_enabled","auto_pause_music","music_volume","expected_version"].contains(&key.as_str()){return Err("Unknown preference field".into())}}
    for key in ["notifications_enabled","auto_pause_music"]{if let Some(v)=incoming.get(key){if !v.is_boolean(){return Err(format!("{key} must be boolean"))}}}
    if let Some(v)=incoming.get("music_volume"){let volume=v.as_f64().ok_or("music_volume must be numeric")?;if !(0.0..=1.0).contains(&volume){return Err("music_volume must be between 0 and 1".into())}}
    if let Some(value)=incoming.get("notifications_enabled"){
        let version=current["sync_version"].as_i64().ok_or("Invalid preference version")?;
        if incoming.get("expected_version").and_then(Value::as_i64)!=Some(version){return Err("Notifications changed locally. Refresh before saving.".into())}
        if *value!=current["notifications_enabled"]{
            let previous:Option<String>=tx.query_row("SELECT change_id FROM sync_outbox WHERE account_id=?1 AND entity_type='daily_preferences' AND synced_at IS NULL ORDER BY rowid DESC LIMIT 1",[account],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
            let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
            let payload=json!({"notifications_enabled":value,"expected_version":version,"depends_on":previous});
            tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'daily_preferences',?3,'update',?4)",params![change_id,device,account,payload.to_string()]).map_err(|e|e.to_string())?;
            current["notifications_enabled"]=value.clone();current["sync_version"]=json!(version+1);current["pending_sync"]=json!(true);
        }
    }
    for field in ["auto_pause_music","music_volume"]{if let Some(v)=incoming.get(field){current[field]=v.clone();}}
    write(&tx,&current)?;tx.commit().map_err(|e|e.to_string())?;Ok(current)
}
fn pull(c:&mut Connection,account:&str,preferences:Value)->Result<(),String>{
    if !preferences["notifications_enabled"].is_boolean()||preferences["sync_version"].as_i64().unwrap_or(-1)<0{return Err("Invalid server notification preference".into())}
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    local_db::require_sync_account(&tx,account)?;
    let mut current=read(&tx)?;
    if current["pending_sync"]!=true{
        for field in ["notifications_enabled","sync_version","updated_at"]{current[field]=preferences[field].clone();}
        write(&tx,&current)?;
    }
    tx.commit().map_err(|e|e.to_string())
}
#[tauri::command]
pub fn get_local_daily_use_preferences(app:AppHandle,expected_account_id:String)->Result<Value,String>{
    let c=local_db::open_local_connection(&app)?;local_db::require_sync_account(&c,&expected_account_id)?;read(&c)
}
#[tauri::command]
pub fn update_local_daily_use_preferences(app:AppHandle,preferences:Value,expected_account_id:String)->Result<Value,String>{
    update(&mut local_db::open_local_connection(&app)?,&expected_account_id,preferences,&local_db::new_uuid())
}
#[tauri::command]
pub fn apply_server_daily_preferences(app:AppHandle,preferences:Value,expected_account_id:String)->Result<(),String>{
    pull(&mut local_db::open_local_connection(&app)?,&expected_account_id,preferences)
}

#[cfg(test)]
mod tests{
    use super::*;
    fn fixture(account:&str)->Connection{
        let c=Connection::open_in_memory().unwrap();local_db::ensure_schema(&c).unwrap();
        c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);").unwrap();
        c.execute("INSERT INTO local_users VALUES('local',?1,1,datetime('now','+24 hours'))",[account]).unwrap();c.execute("INSERT INTO local_session VALUES(1,'local')",[]).unwrap();c
    }
    #[test]
    fn hybrid_atomic_notification_and_local_media(){
        let mut a=fixture("a");let mut b=fixture("a");
        // Populated pre-hybrid row upgrades without losing this installation's values.
        write(&a,&json!({"notifications_enabled":true,"music_volume":0.21,"auto_pause_music":true})).unwrap();
        assert_eq!(read(&a).unwrap()["sync_version"],0);
        let r=update(&mut a,"a",json!({"notifications_enabled":false,"expected_version":0,"music_volume":0.31}),"one").unwrap();
        assert_eq!(r["pending_sync"],true);
        assert!(update(&mut a,"a",json!({"notifications_enabled":true,"expected_version":1,"music_volume":0.8}),"one").is_err());
        assert_eq!(read(&a).unwrap()["music_volume"],0.31);
        update(&mut a,"a",json!({"auto_pause_music":false}),"not-queued").unwrap();
        assert_eq!(a.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        pull(&mut a,"a",json!({"notifications_enabled":true,"sync_version":5})).unwrap();assert_eq!(read(&a).unwrap()["notifications_enabled"],false);
        a.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP",[]).unwrap();
        for c in [&mut a,&mut b]{pull(c,"a",json!({"notifications_enabled":false,"sync_version":1})).unwrap();}
        assert_eq!(read(&a).unwrap()["music_volume"],0.31);assert_eq!(read(&b).unwrap()["music_volume"],0.7);
        assert_eq!(read(&b).unwrap()["notifications_enabled"],false);
        assert!(update(&mut a,"other",json!({"music_volume":0.9}),"bad").is_err());
    }
    #[test]
    fn invalid_preference_does_not_write_or_queue(){
        let mut c=fixture("a");
        for value in [json!({"music_volume":2}),json!({"notifications_enabled":"false","expected_version":0}),json!({"auto_pause_music":0}),json!({"notifications_enabled":false,"expected_version":9})]{
            assert!(update(&mut c,"a",value,"no").is_err());
        }
        assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert!(pull(&mut c,"a",json!({})).is_err());
    }
}

#[cfg(test)]
#[path = "local_system_live_test.rs"]
mod live_tests;
