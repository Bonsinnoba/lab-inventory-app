use rusqlite::{params,OptionalExtension,Connection,TransactionBehavior};
use tauri::AppHandle;
use crate::{local_auth,local_db,local_resources};

fn schema(c:&Connection)->Result<(),String>{
    c.execute_batch("CREATE TABLE IF NOT EXISTS local_resource_posters(account_id TEXT NOT NULL,resource_id TEXT NOT NULL,revision TEXT NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(account_id,resource_id)); CREATE TABLE IF NOT EXISTS local_resource_poster_denials(account_id TEXT NOT NULL,resource_id TEXT NOT NULL,PRIMARY KEY(account_id,resource_id));").map_err(|e|e.to_string())
}
fn authorize(c:&Connection,account:&str,id:&str,revision:&str)->Result<(),String>{
    local_db::require_sync_account(c,account)?;
    local_auth::require_local_permission(c,"resources.view")?;
    schema(c)?;
    let denied:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_poster_denials WHERE account_id=?1 AND resource_id=?2)",params![account,id],|r|r.get(0)).map_err(|e|e.to_string())?;
    if denied{return Err("Resource preview access revoked".into())}
    let r=local_resources::read_resources(c)?.into_iter().find(|r|r.id==id).ok_or("Resource unavailable on this PC")?;
    if r.updated_at!=revision{return Err("Resource changed while loading its preview".into())}
    if r.file_type!="video"&&r.local_media_filename.is_none(){return Err("Resource has no video preview".into())}
    Ok(())
}
pub(crate) fn restrict_to_visible(c:&Connection,account:&str,visible:&std::collections::HashSet<String>)->Result<(),String>{
    schema(c)?;
    for r in local_resources::read_resources(c)?{
        if visible.contains(&r.id.replace('-',"").to_ascii_lowercase()){
            c.execute("DELETE FROM local_resource_poster_denials WHERE account_id=?1 AND resource_id=?2",params![account,r.id]).map_err(|e|e.to_string())?;
        }else{
            c.execute("INSERT OR IGNORE INTO local_resource_poster_denials(account_id,resource_id) VALUES(?1,?2)",params![account,r.id]).map_err(|e|e.to_string())?;
            c.execute("DELETE FROM local_resource_posters WHERE account_id=?1 AND resource_id=?2",params![account,r.id]).map_err(|e|e.to_string())?;
        }
    }Ok(())
}
pub(crate) fn purge_absent(c:&Connection,resources:&[local_resources::LocalResource])->Result<(),String>{
    schema(c)?;let account=local_db::active_account(c)?;
    let ids=serde_json::to_string(&resources.iter().map(|r|&r.id).collect::<Vec<_>>()).map_err(|e|e.to_string())?;
    c.execute("DELETE FROM local_resource_posters WHERE account_id=?1 AND resource_id NOT IN (SELECT value FROM json_each(?2))",params![account,ids]).map_err(|e|e.to_string())?;Ok(())
}
#[tauri::command]
pub fn read_local_resource_poster(app:AppHandle,expected_account_id:String,resource_id:String,revision:String)->Result<Option<Vec<u8>>,String>{
    let c=local_db::open_local_connection(&app)?;authorize(&c,&expected_account_id,&resource_id,&revision)?;schema(&c)?;
    c.query_row("SELECT bytes FROM local_resource_posters WHERE account_id=?1 AND resource_id=?2 AND revision=?3",params![expected_account_id,resource_id,revision],|r|r.get(0)).optional().map_err(|e|e.to_string())
}
#[tauri::command]
pub fn cache_local_resource_poster(app:AppHandle,expected_account_id:String,expected_session_token:String,resource_id:String,revision:String,bytes:Vec<u8>)->Result<(),String>{
    if bytes.len()<4||bytes.len()>1048576||bytes[0]!=255||bytes[1]!=216||bytes[bytes.len()-2]!=255||bytes[bytes.len()-1]!=217{return Err("Invalid JPEG preview".into())}
    let mut c=local_db::open_local_connection(&app)?;schema(&c)?;
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    authorize(&tx,&expected_account_id,&resource_id,&revision)?;
    let token:String=tx.query_row("SELECT session_token FROM local_session WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    if token!=expected_session_token{return Err("Session changed while caching preview".into())}
    tx.execute("INSERT INTO local_resource_posters(account_id,resource_id,revision,bytes) VALUES(?1,?2,?3,?4) ON CONFLICT(account_id,resource_id) DO UPDATE SET revision=excluded.revision,bytes=excluded.bytes",params![expected_account_id,resource_id,revision,bytes]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())
}
