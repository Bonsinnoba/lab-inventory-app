use argon2::{Argon2, PasswordHash, PasswordVerifier};
use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::AppHandle;
use crate::local_db::open_local_connection;

#[derive(Debug, Serialize)]
pub struct LocalUser {
    pub id: String,
    pub central_user_id: Option<String>,
    pub username: String,
    pub role: String,
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub is_active: bool,
    pub offline_expires_at: Option<String>,
}

fn ensure_auth_schema(c: &rusqlite::Connection) -> Result<(), String> {
    c.execute_batch(r#"
      CREATE TABLE IF NOT EXISTS local_users (
        id TEXT PRIMARY KEY,
        central_user_id TEXT UNIQUE,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        display_name TEXT,
        email TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        permissions_json TEXT NOT NULL DEFAULT '[]',
        last_server_auth_at TEXT,
        offline_expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS local_session (
        id INTEGER PRIMARY KEY CHECK(id=1),
        user_id TEXT NOT NULL,
        session_token TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS local_auth_generation (
        id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO local_auth_generation VALUES(1,0);
      CREATE TABLE IF NOT EXISTS local_login_attempts (
        user_id TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0,
        retry_after INTEGER NOT NULL DEFAULT 0
      );
    "#).map_err(|e| format!("Unable to initialize local auth schema: {e}"))?;

    let mut columns = std::collections::HashSet::new();
    {
        let mut stmt = c.prepare("PRAGMA table_info(local_users)")
            .map_err(|e| format!("Unable to inspect local auth schema: {e}"))?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(1))
            .map_err(|e| format!("Unable to inspect local auth columns: {e}"))?;
        for row in rows {
            columns.insert(row.map_err(|e| format!("Unable to read local auth column: {e}"))?);
        }
    }
    for (name, definition) in [
        ("central_user_id", "TEXT"),
        ("permissions_json", "TEXT NOT NULL DEFAULT '[]'"),
        ("last_server_auth_at", "TEXT"),
        ("offline_expires_at", "TEXT"),
    ] {
        if !columns.contains(name) {
            c.execute(&format!("ALTER TABLE local_users ADD COLUMN {name} {definition}"), [])
                .map_err(|e| format!("Unable to migrate local auth schema: {e}"))?;
        }
    }
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_local_users_central_user_id ON local_users(central_user_id) WHERE central_user_id IS NOT NULL", [])
        .map_err(|e| format!("Unable to enforce central account uniqueness: {e}"))?;
    enforce_offline_lease_bounds(c)
}

fn offline_lease_modifier(role: &str, permissions: &[String]) -> &'static str {
    let privileged = role == "admin" || permissions.iter().any(|p| matches!(p.as_str(),
        "audit.view" | "finance.view_sensitive" | "finance.import" |
        "users.create" | "users.edit" | "users.manage_permissions" |
        "users.manage_roles" | "users.reset_password"));
    if privileged { "+24 hours" } else { "+7 days" }
}

// Cap leases from the last password-authenticated login. Reading permissions,
// reopening the app, and upgrading an old cache must never renew credentials.
pub(crate) fn enforce_offline_lease_bounds(c: &rusqlite::Connection) -> Result<(), String> {
    let columns: Vec<String> = c.prepare("PRAGMA table_info(local_users)")
        .map_err(|e| e.to_string())?.query_map([], |row| row.get(1))
        .map_err(|e| e.to_string())?.collect::<Result<_, _>>().map_err(|e| e.to_string())?;
    if !["role", "permissions_json", "last_server_auth_at", "offline_expires_at"].iter()
        .all(|name| columns.iter().any(|column| column == name)) { return Ok(()); }
    let now:i64=c.query_row("SELECT CAST(strftime('%s','now') AS INTEGER)",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    enforce_clock_high_water(c,now)?;
    let accounts: Vec<(String, String, String)> = c.prepare("SELECT id,role,permissions_json FROM local_users")
        .map_err(|e| e.to_string())?.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?.collect::<Result<_, _>>().map_err(|e| e.to_string())?;
    for (id, role, raw) in accounts {
        let permissions = serde_json::from_str::<Vec<String>>(&raw);
        let modifier = permissions.as_ref().map(|p| offline_lease_modifier(&role, p)).unwrap_or("+0 seconds");
        c.execute("UPDATE local_users SET offline_expires_at=CASE
            WHEN datetime(last_server_auth_at,?2) IS NULL THEN NULL
            ELSE datetime(last_server_auth_at,?2) END
            WHERE id=?1 AND offline_expires_at IS NOT NULL AND (
              datetime(offline_expires_at) IS NULL OR datetime(last_server_auth_at,?2) IS NULL
              OR datetime(offline_expires_at)>datetime(last_server_auth_at,?2))", params![id, modifier])
            .map_err(|e| format!("Unable to bound offline authorization: {e}"))?;
    }
    Ok(())
}

fn enforce_clock_high_water(c:&rusqlite::Connection,now:i64)->Result<(),String>{
    c.execute_batch("CREATE TABLE IF NOT EXISTS local_auth_clock(id INTEGER PRIMARY KEY CHECK(id=1),last_seen INTEGER NOT NULL);").map_err(|e|e.to_string())?;
    c.execute("INSERT INTO local_auth_clock VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET last_seen=MAX(last_seen,excluded.last_seen)",params![now]).map_err(|e|e.to_string())?;
    // A backward jump beyond five minutes invalidates leases, not authored work.
    // Native online password verification is the recovery path. This is a guard
    // against clock changes, not protection against a compromised OS/database.
    c.execute("UPDATE local_users SET offline_expires_at=NULL WHERE offline_expires_at IS NOT NULL AND ?1 < (SELECT last_seen-300 FROM local_auth_clock WHERE id=1)",params![now]).map_err(|e|e.to_string())?;
    Ok(())
}

fn map_user(r:&rusqlite::Row)->rusqlite::Result<LocalUser>{
    Ok(LocalUser{
        // UI/repository identity is always the central account, never the
        // private local credential-row key used by local_session.
        id:r.get(1)?,
        central_user_id:r.get(1)?,
        username:r.get(2)?,
        role:r.get(3)?,
        display_name:r.get(4)?,
        email:r.get(5)?,
        is_active:r.get::<_,i64>(6)?!=0,
        offline_expires_at:r.get(7)?,
    })
}


pub fn require_local_permission(c:&rusqlite::Connection,permission:&str)->Result<(),String>{
    let (permissions,expires): (String,Option<String>)=c.query_row(
        "SELECT u.permissions_json,u.offline_expires_at FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1 AND u.central_user_id IS NOT NULL AND u.is_active=1",
        [],|r|Ok((r.get(0)?,r.get(1)?))
    ).optional().map_err(|e|format!("Unable to read local authorization: {e}"))?
     .ok_or("Not authenticated")?;
    let expires=expires.ok_or("Offline authorization has expired")?;
    let valid:i64=c.query_row("SELECT CASE WHEN datetime('now') < datetime(?1) THEN 1 ELSE 0 END",params![expires],|r|r.get(0)).unwrap_or(0);
    if valid==0{return Err("Offline authorization has expired. Connect to LabOS to refresh access.".into())}
    let permissions:Vec<String>=serde_json::from_str(&permissions).map_err(|e|format!("Unable to decode local authorization: {e}"))?;
    if permissions.iter().any(|p|p==permission){Ok(())}else{Err(format!("Permission required: {permission}"))}
}

fn hash_password(password:&str)->Result<String,String>{
    let salt=SaltString::generate(&mut OsRng);
    Argon2::default().hash_password(password.as_bytes(),&salt)
        .map(|h|h.to_string())
        .map_err(|e|format!("Unable to hash password: {e}"))
}

fn verify_password(password:&str,hash:&str)->Result<bool,String>{
    let parsed=PasswordHash::new(hash).map_err(|e|format!("Invalid stored password hash: {e}"))?;
    Ok(Argon2::default().verify_password(password.as_bytes(),&parsed).is_ok())
}

fn session_token()->String{format!("{}{}",uuid::Uuid::new_v4(),uuid::Uuid::new_v4())}

fn advance_generation(c:&rusqlite::Connection)->Result<i64,String>{
    c.query_row("UPDATE local_auth_generation SET generation=generation+1 WHERE id=1 RETURNING generation",[],|r|r.get(0)).map_err(|e|e.to_string())
}
fn check_generation(c:&rusqlite::Connection,expected:i64)->Result<(),String>{
    let actual:i64=c.query_row("SELECT generation FROM local_auth_generation WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    if actual!=expected{return Err("Session changed while signing in; retry sign-in".into())} Ok(())
}

fn authorization_guard(c:&rusqlite::Connection,account:&str)->Result<Option<String>,String>{
    // This is a compare-and-lock guard, NOT an authorization or lease renewal.
    c.query_row("SELECT s.session_token FROM local_session s JOIN local_users u ON u.id=s.user_id WHERE s.id=1 AND u.central_user_id=?1",
        params![account],|r|r.get(0)).optional().map_err(|e|format!("Unable to capture native session: {e}"))
}

#[tauri::command]
pub fn local_authorization_guard(app:AppHandle,expected_account_id:String)->Result<Option<String>,String>{
    let c=open_local_connection(&app)?;ensure_auth_schema(&c)?;
    authorization_guard(&c,&expected_account_id)
}

pub(crate) fn invalidate_authorization(c:&mut rusqlite::Connection,account:&str,expected_token:&str)->Result<bool,String>{
    let tx=c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    if authorization_guard(&tx,account)?.as_deref()!=Some(expected_token){return Ok(false)}
    // Never delete business rows, outbox entries or authorship. Only a new online
    // password login may recreate access; permission refresh cannot unlock it.
    tx.execute("UPDATE local_users SET is_active=0,offline_expires_at=NULL,permissions_json='[]' WHERE central_user_id=?1",params![account])
        .map_err(|e|format!("Unable to lock cached authorization: {e}"))?;
    tx.execute("DELETE FROM local_session WHERE id=1 AND session_token=?1",params![expected_token]).map_err(|e|e.to_string())?;
    advance_generation(&tx)?;
    tx.commit().map_err(|e|format!("Unable to commit authorization lock: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub fn invalidate_local_authorization(app:AppHandle,expected_account_id:String,expected_session_token:String)->Result<bool,String>{
    let mut c=open_local_connection(&app)?;ensure_auth_schema(&c)?;
    invalidate_authorization(&mut c,&expected_account_id,&expected_session_token)
}

#[tauri::command]
pub fn local_auth_status(app:AppHandle)->Result<serde_json::Value,String>{
    let c=open_local_connection(&app)?; ensure_auth_schema(&c)?;
    let count:i64=c.query_row(
        "SELECT COUNT(*) FROM local_users WHERE central_user_id IS NOT NULL AND is_active=1",
        [],|r|r.get(0)
    ).map_err(|e|format!("Unable to inspect cached accounts: {e}"))?;
    let user=c.query_row(
        "SELECT id,central_user_id,username,role,display_name,email,is_active,offline_expires_at FROM local_users WHERE id=(SELECT user_id FROM local_session WHERE id=1) AND central_user_id IS NOT NULL AND is_active=1 AND datetime('now')<datetime(offline_expires_at)",
        [],map_user
    ).optional().map_err(|e|format!("Unable to inspect local session: {e}"))?;
    let token:Option<String>=if user.is_some(){
        c.query_row("SELECT session_token FROM local_session WHERE id=1",[],|r|r.get::<_,String>(0))
            .optional().map_err(|e|format!("Unable to restore local session: {e}"))?
            .map(|value|format!("local:{value}"))
    }else{None};
    Ok(serde_json::json!({"bootstrapped":count>0,"authenticated":user.is_some(),"user":user,"token":token}))
}

#[tauri::command]
pub async fn cache_server_user(app:AppHandle,username:String,password:String)->Result<serde_json::Value,crate::native_authorization::AuthError>{
    use crate::native_authorization::{self,AuthError};
    if username.trim().len()<3||username.trim().len()>64||password.len()<8||password.len()>128{
        return Err(AuthError::invalid("Invalid username or password length"));
    }
    let generation={
        let c=open_local_connection(&app).map_err(|e|AuthError::invalid(&e))?;
        ensure_auth_schema(&c).map_err(|e|AuthError::invalid(&e))?;
        advance_generation(&c).map_err(|e|AuthError::invalid(&e))?
    };
    let verified=native_authorization::login(username.trim(),&password).await;
    let mut c=open_local_connection(&app).map_err(|e|AuthError::invalid(&e))?;
    finish_native_login(&mut c,verified,&username,&password,generation)
}

fn finish_native_login(c:&mut rusqlite::Connection,verified:Result<crate::native_authorization::VerifiedLogin,crate::native_authorization::AuthError>,username:&str,password:&str,generation:i64)->Result<serde_json::Value,crate::native_authorization::AuthError>{
    use crate::native_authorization::AuthError;
    match verified {
        Ok(verified)=>publish_verified_login(c,verified,password,generation).map_err(|e|AuthError::invalid(&e)),
        Err(error) if error.code=="AUTH_UNAVAILABLE"=>login_cached_generation(c,username,password,Some(generation)).map_err(|e|AuthError::invalid(&e)),
        Err(error)=>Err(error),
    }
}

fn publish_verified_login(connection:&mut rusqlite::Connection,verified:crate::native_authorization::VerifiedLogin,password:&str,generation:i64)->Result<serde_json::Value,String>{
    let crate::native_authorization::VerifiedLogin{user,token:server_token,permissions}=verified;
    let crate::native_authorization::ServerUser{id:central_user_id,username,role,display_name,email,..}=user;
    if central_user_id.trim().is_empty(){return Err("Central user ID is required".into())}
    if username.trim().len()<3||username.trim().len()>64{return Err("Username must be between 3 and 64 characters".into())}
    if password.len()<8||password.len()>128{return Err("Password must be between 8 and 128 characters".into())}
    let hash=hash_password(&password)?;
    // Publish refreshed credentials and their new session together. Otherwise
    // an old in-flight revocation could lock the newly refreshed account between
    // the user UPDATE and session INSERT.
    let c=connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e|format!("Unable to begin cached login: {e}"))?;
    check_generation(&c,generation)?;
    c.execute("UPDATE local_auth_clock SET last_seen=CAST(strftime('%s','now') AS INTEGER) WHERE id=1",[]).map_err(|e|e.to_string())?;
    let lease=offline_lease_modifier(&role,&permissions);
    let permissions_json=serde_json::to_string(&permissions).map_err(|e|format!("Unable to encode permissions: {e}"))?;
    let local_id:Option<String>=c.query_row(
        "SELECT id FROM local_users WHERE central_user_id=?1",
        params![central_user_id.trim()],|r|r.get(0)
    ).optional().map_err(|e|format!("Unable to inspect cached account: {e}"))?;
    let local_id=match local_id {
        Some(id)=>id,
        None=>{
            let legacy:Option<(String,Option<String>)>=c.query_row(
                "SELECT id,central_user_id FROM local_users WHERE username=?1",
                params![username.trim()],|r|Ok((r.get(0)?,r.get(1)?))
            ).optional().map_err(|e|format!("Unable to inspect local username: {e}"))?;
            if let Some((id,Some(existing_central)))=legacy {
                if existing_central != central_user_id.trim(){return Err("That username is already cached for another LabOS account.".into())}
                id
            } else if let Some((id,None))=legacy {
                id
            } else {
                uuid::Uuid::new_v4().to_string()
            }
        }
    };
    let token=session_token();

    let exists:bool=c.query_row(
        "SELECT EXISTS(SELECT 1 FROM local_users WHERE id=?1)",
        params![local_id],|r|r.get(0)
    ).map_err(|e|format!("Unable to inspect cached account row: {e}"))?;
    if exists {
        c.execute(
            "UPDATE local_users SET central_user_id=?1,username=?2,password_hash=?3,role=?4,display_name=?5,email=?6,is_active=1,permissions_json=?7,last_server_auth_at=CURRENT_TIMESTAMP,offline_expires_at=datetime('now',?8) WHERE id=?9",
            params![central_user_id.trim(),username.trim(),hash,role,display_name,email,permissions_json,lease,local_id]
        ).map_err(|e|format!("Unable to update cached server account: {e}"))?;
    } else {
        c.execute(
            "INSERT INTO local_users(id,central_user_id,username,password_hash,role,display_name,email,is_active,permissions_json,last_server_auth_at,offline_expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,1,?8,CURRENT_TIMESTAMP,datetime('now',?9))",
            params![local_id,central_user_id.trim(),username.trim(),hash,role,display_name,email,permissions_json,lease]
        ).map_err(|e|format!("Unable to cache server account: {e}"))?;
    }
    c.execute(
        "INSERT INTO local_session(id,user_id,session_token) VALUES(1,?1,?2)
         ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,session_token=excluded.session_token",
        params![local_id,token]
    ).map_err(|e|format!("Unable to create local session: {e}"))?;
    c.execute("DELETE FROM local_login_attempts WHERE user_id=?1",params![local_id]).map_err(|e|e.to_string())?;
    let response=serde_json::json!({"user":{
        "id":central_user_id.trim(),"central_user_id":central_user_id.trim(),"username":username.trim(),
        "role":role,"display_name":display_name,"email":email,"is_active":true,
        "offline_expires_at":c.query_row("SELECT offline_expires_at FROM local_users WHERE id=?1",params![local_id],|r|r.get::<_,String>(0)).unwrap_or_default()
    },"token":server_token});
    c.commit().map_err(|e|format!("Unable to commit cached login: {e}"))?;
    Ok(response)
}

#[tauri::command]
pub fn local_login(app:AppHandle,username:String,password:String)->Result<serde_json::Value,String>{
    let mut c=open_local_connection(&app)?;ensure_auth_schema(&c)?;
    login_cached(&mut c,&username,&password)
}

fn login_cached(connection:&mut rusqlite::Connection,username:&str,password:&str)->Result<serde_json::Value,String>{
    login_cached_generation(connection,username,password,None)
}
fn login_cached_generation(connection:&mut rusqlite::Connection,username:&str,password:&str,expected_generation:Option<i64>)->Result<serde_json::Value,String>{
    // Password verification and session publication must use the same cached
    // credential generation; online refresh/revocation cannot interleave.
    let c=connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e|format!("Unable to begin offline login: {e}"))?;
    if let Some(expected)=expected_generation{check_generation(&c,expected)?;}
    advance_generation(&c)?;
    let row=c.query_row(
        "SELECT id,central_user_id,username,password_hash,role,display_name,email,is_active,offline_expires_at
         FROM local_users WHERE username=?1 AND central_user_id IS NOT NULL",
        params![username.trim()],
        |r|Ok((
            r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,
            r.get::<_,String>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,Option<String>>(6)?,
            r.get::<_,i64>(7)?,r.get::<_,Option<String>>(8)?
        ))
    ).optional().map_err(|e|format!("Unable to read local account: {e}"))?
     .ok_or("This account is not available on this installation. Connect to LabOS to sign in first.")?;

    if row.7==0{return Err("Cached access is locked. Connect to LabOS and sign in again.".into())}
    let now:i64=c.query_row("SELECT CAST(strftime('%s','now') AS INTEGER)",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    let (failures,retry_after):(i64,i64)=c.query_row("SELECT failures,retry_after FROM local_login_attempts WHERE user_id=?1",params![row.0],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|e.to_string())?.unwrap_or((0,0));
    if now<retry_after{return Err(format!("Too many offline sign-in attempts. Try again in {} seconds or sign in online.",retry_after-now))}
    if !verify_password(&password,&row.3)?{
        let failures=(failures+1).min(20);
        let delay=if failures<5 {0} else {(15i64 * (1i64 << (failures-5).min(6))).min(900)};
        c.execute("INSERT INTO local_login_attempts VALUES(?1,?2,?3) ON CONFLICT(user_id) DO UPDATE SET failures=excluded.failures,retry_after=excluded.retry_after",params![row.0,failures,now+delay]).map_err(|e|e.to_string())?;
        c.commit().map_err(|e|e.to_string())?;
        return Err("Invalid credentials".into());
    }
    let expires=row.8.clone().ok_or("Offline access is not available. Connect to LabOS to sign in.")?;
    let valid= c.query_row(
        "SELECT CASE WHEN datetime('now') < datetime(?1) THEN 1 ELSE 0 END",
        params![expires],|r|r.get::<_,i64>(0)
    ).unwrap_or(0);
    if valid==0{return Err("Offline access has expired. Connect to LabOS to sign in again.".into())}
    c.execute("DELETE FROM local_login_attempts WHERE user_id=?1",params![row.0]).map_err(|e|e.to_string())?;

    let token=session_token();
    c.execute(
        "INSERT INTO local_session(id,user_id,session_token) VALUES(1,?1,?2)
         ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,session_token=excluded.session_token",
        params![row.0,token]
    ).map_err(|e|format!("Unable to create local session: {e}"))?;
    let response=serde_json::json!({"user":{
        "id":row.1,"central_user_id":row.1,"username":row.2,"role":row.4,
        "display_name":row.5,"email":row.6,"is_active":true,"offline_expires_at":row.8
    },"token":format!("local:{token}")});
    c.commit().map_err(|e|format!("Unable to commit offline login: {e}"))?;
    Ok(response)
}

#[tauri::command]
pub fn local_current_user(app:AppHandle)->Result<Option<LocalUser>,String>{
    let c=open_local_connection(&app)?;ensure_auth_schema(&c)?;
    c.query_row(
        "SELECT u.id,u.central_user_id,u.username,u.role,u.display_name,u.email,u.is_active,u.offline_expires_at
         FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1 AND u.central_user_id IS NOT NULL AND u.is_active=1 AND u.offline_expires_at IS NOT NULL AND datetime('now') < datetime(u.offline_expires_at)",
        [],map_user
    ).optional().map_err(|e|format!("Unable to read local session: {e}"))
}

#[tauri::command]
pub async fn cache_server_permissions(app:AppHandle,central_user_id:String,server_token:String,expected_session_token:String)->Result<Vec<String>,String>{
    {
        let c=open_local_connection(&app)?;ensure_auth_schema(&c)?;
        if authorization_guard(&c,&central_user_id)?.as_deref()!=Some(&expected_session_token){return Err("Native session changed".into())}
    }
    let verified=match crate::native_authorization::permissions(&server_token,&central_user_id).await {
        Ok(verified)=>verified,
        Err(error)=>{
            if error.code=="AUTH_REVOKED" {
                let mut c=open_local_connection(&app)?;
                invalidate_authorization(&mut c,&central_user_id,&expected_session_token)?;
            }
            return Err(format!("{}: {}",error.code,error.message));
        }
    };
    let mut c=open_local_connection(&app)?;
    let tx=c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    refresh_permissions(&tx,&verified.user.id,&verified.user.role,&verified.permissions,&expected_session_token)?;
    tx.commit().map_err(|e|e.to_string())?;
    Ok(verified.permissions)
}

fn refresh_permissions(c:&rusqlite::Connection,central_user_id:&str,role:&str,permissions:&[String],expected_session_token:&str)->Result<(),String>{
    let permissions_json=serde_json::to_string(&permissions).map_err(|e|format!("Unable to encode permissions: {e}"))?;
    let updated=c.execute(
        "UPDATE local_users SET role=?1,permissions_json=?2 WHERE central_user_id=?3 AND is_active=1 AND offline_expires_at IS NOT NULL
         AND id=(SELECT user_id FROM local_session WHERE id=1 AND session_token=?4)",
        params![role,permissions_json,central_user_id.trim(),expected_session_token]
    ).map_err(|e|format!("Unable to refresh cached permissions: {e}"))?;
    if updated==0{return Err("Cached session changed or requires online sign-in".into())}
    enforce_offline_lease_bounds(c)
}

#[tauri::command]
pub fn local_current_permissions(app:AppHandle)->Result<Vec<String>,String>{
    let c=open_local_connection(&app)?;ensure_auth_schema(&c)?;
    let (permissions,expires):(String,Option<String>)=c.query_row(
        "SELECT u.permissions_json,u.offline_expires_at FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1 AND u.central_user_id IS NOT NULL AND u.is_active=1",
        [],|r|Ok((r.get(0)?,r.get(1)?))
    ).optional().map_err(|e|format!("Unable to read local permissions: {e}"))?
     .ok_or("Not authenticated")?;
    let expires=expires.ok_or("Offline authorization has expired")?;
    let valid:i64=c.query_row("SELECT CASE WHEN datetime('now') < datetime(?1) THEN 1 ELSE 0 END",params![expires],|r|r.get(0)).unwrap_or(0);
    if valid==0{return Err("Offline authorization has expired. Connect to LabOS to refresh access.".into())}
    serde_json::from_str(&permissions).map_err(|e|format!("Unable to decode local permissions: {e}"))
}

#[tauri::command]
pub fn local_logout(app:AppHandle)->Result<(),String>{
    let mut connection=open_local_connection(&app)?;ensure_auth_schema(&connection)?;
    let c=connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    advance_generation(&c)?;
    c.execute("DELETE FROM local_session WHERE id=1",[])
        .map_err(|e|format!("Unable to clear local session: {e}"))?;
    c.commit().map_err(|e|e.to_string())
}

#[tauri::command]
pub fn local_change_password(_app:AppHandle,_current_password:String,_new_password:String)->Result<(),String>{
    Err("Password changes require an online LabOS connection.".into())
}

#[tauri::command]
pub fn local_update_profile(_app:AppHandle,_display_name:Option<String>,_email:Option<String>)->Result<LocalUser,String>{
    Err("Profile changes require an online LabOS connection.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore="requires the real Docker API stopped and LABOS_AUTH_STOPPED_PROBE=1"]
    fn stopped_api_native_fallback_preserves_lease_and_author(){
        assert_eq!(std::env::var("LABOS_AUTH_STOPPED_PROBE").as_deref(),Ok("1"));
        let path=std::env::temp_dir().join(format!("labos-stopped-auth-{}.sqlite",uuid::Uuid::new_v4()));
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {fn drop(&mut self){let _=std::fs::remove_file(&self.0);}}
        let _cleanup=Cleanup(path.clone());
        {
            let mut c=rusqlite::Connection::open(&path).unwrap();revoked_fixture(&c);
            let expiry:String=c.query_row("SELECT offline_expires_at FROM local_users WHERE username='alice'",[],|r|r.get(0)).unwrap();
            let generation=advance_generation(&c).unwrap();
            let result=tauri::async_runtime::block_on(crate::native_authorization::login("alice","fixture-password"));
            assert_eq!(result.as_ref().err().unwrap().code,"AUTH_UNAVAILABLE");
            let response=finish_native_login(&mut c,result,"alice","fixture-password",generation).unwrap();
            assert!(response["token"].as_str().unwrap().starts_with("local:"));
            assert_eq!(response["user"]["id"],"account-a");
            assert_eq!(response["user"]["offline_expires_at"],expiry);
        }
        {
            let mut c=rusqlite::Connection::open(&path).unwrap();ensure_auth_schema(&c).unwrap();
            assert_eq!(crate::local_db::active_account(&c).unwrap(),"account-a");
            assert!(require_local_permission(&c,"notes.view").is_ok());
            assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox WHERE account_id='account-a'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
            c.execute("UPDATE local_users SET offline_expires_at=datetime('now','-1 minute') WHERE username='alice'",[]).unwrap();
            let generation=advance_generation(&c).unwrap();
            let result=tauri::async_runtime::block_on(crate::native_authorization::login("alice","fixture-password"));
            assert!(finish_native_login(&mut c,result,"alice","fixture-password",generation).unwrap_err().message.contains("expired"));
        }
        println!("PASS real stopped API -> native cached-password fallback -> disk reopen, unchanged lease/authorship, expired-cache denial (not GUI acceptance).");
    }

    #[test]
    fn offline_password_backoff_persists_across_connections_and_is_account_scoped(){
        let path=std::env::temp_dir().join(format!("labos-throttle-{}.sqlite",uuid::Uuid::new_v4()));
        {
            let mut c=rusqlite::Connection::open(&path).unwrap();revoked_fixture(&c);
            for _ in 0..5 {assert_eq!(login_cached(&mut c,"alice","wrong-password").unwrap_err(),"Invalid credentials");}
        }
        {
            let mut c=rusqlite::Connection::open(&path).unwrap();ensure_auth_schema(&c).unwrap();
            assert!(login_cached(&mut c,"alice","fixture-password").unwrap_err().contains("Too many"));
            assert!(login_cached(&mut c,"bob","fixture-password").is_ok());
            c.execute("UPDATE local_login_attempts SET retry_after=0 WHERE user_id='local-a'",[]).unwrap();
            assert!(login_cached(&mut c,"alice","fixture-password").is_ok());
            assert_eq!(c.query_row("SELECT COUNT(*) FROM local_login_attempts",[],|r|r.get::<_,i64>(0)).unwrap(),0);
            assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn clock_rollback_expires_leases_without_erasing_authored_work(){
        let mut c=rusqlite::Connection::open_in_memory().unwrap();revoked_fixture(&c);
        let now:i64=c.query_row("SELECT CAST(strftime('%s','now') AS INTEGER)",[],|r|r.get(0)).unwrap();
        enforce_clock_high_water(&c,now).unwrap();
        enforce_clock_high_water(&c,now-299).unwrap();
        assert!(require_local_permission(&c,"notes.view").is_ok());
        enforce_clock_high_water(&c,now-301).unwrap();
        assert!(require_local_permission(&c,"notes.view").is_err());
        assert!(login_cached(&mut c,"alice","fixture-password").is_err());
        enforce_clock_high_water(&c,now).unwrap();
        assert!(require_local_permission(&c,"notes.view").is_err());
        assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),2);
    }

    #[test]
    fn late_verified_login_cannot_overwrite_logout_or_new_login(){
        let mut c=rusqlite::Connection::open_in_memory().unwrap();revoked_fixture(&c);
        let generation=advance_generation(&c).unwrap();
        // A logout must advance even if no session row existed at request start.
        c.execute("DELETE FROM local_session",[]).unwrap();advance_generation(&c).unwrap();
        let verified=crate::native_authorization::VerifiedLogin {
            user:crate::native_authorization::ServerUser{id:uuid::Uuid::new_v4().to_string(),username:"verified-fixture".into(),role:"member".into(),display_name:None,email:None,is_active:Some(true),created_at:None},
            token:"server-token".into(),permissions:vec!["notes.view".into()],
        };
        assert!(publish_verified_login(&mut c,verified,"fixture-password",generation).unwrap_err().contains("Session changed"));
        assert_eq!(c.query_row("SELECT COUNT(*) FROM local_session",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(c.query_row("SELECT COUNT(*) FROM local_users",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        assert!(login_cached_generation(&mut c,"alice","fixture-password",Some(generation)).is_err());
        let generation=advance_generation(&c).unwrap();
        login_cached(&mut c,"bob","fixture-password").unwrap();
        assert!(login_cached_generation(&mut c,"alice","fixture-password",Some(generation)).is_err());
        assert_eq!(crate::local_db::active_account(&c).unwrap(),"account-b");
    }

    fn revoked_fixture(c:&rusqlite::Connection){
        ensure_auth_schema(c).unwrap();
        let hash=hash_password("fixture-password").unwrap();
        for (id,account,name) in [("local-a","account-a","alice"),("local-b","account-b","bob")] {
            c.execute("INSERT INTO local_users(id,central_user_id,username,password_hash,role,permissions_json,last_server_auth_at,offline_expires_at) VALUES(?1,?2,?3,?4,'member','[\"notes.view\"]',CURRENT_TIMESTAMP,datetime('now','+7 days'))",params![id,account,name,hash]).unwrap();
        }
        c.execute("INSERT INTO local_session(id,user_id,session_token) VALUES(1,'local-a','guard-a')",[]).unwrap();
        c.execute_batch("CREATE TABLE sync_outbox(change_id TEXT,account_id TEXT,payload TEXT); INSERT INTO sync_outbox VALUES('pending-a','account-a','authored pending work'),('pending-b','account-b','other author work');").unwrap();
    }

    #[test]
    fn observed_revocation_survives_restart_without_deleting_authored_work(){
        let path=std::env::temp_dir().join(format!("labos-revocation-{}.sqlite",uuid::Uuid::new_v4()));
        {
            let mut c=rusqlite::Connection::open(&path).unwrap();revoked_fixture(&c);
            assert!(!invalidate_authorization(&mut c,"account-b","guard-a").unwrap());
            assert!(!invalidate_authorization(&mut c,"account-a","wrong-guard").unwrap());
            assert!(invalidate_authorization(&mut c,"account-a","guard-a").unwrap());
            assert!(crate::local_db::active_account(&c).is_err());
            assert!(require_local_permission(&c,"notes.view").is_err());
            assert!(refresh_permissions(&c,"account-a","admin",&vec!["notes.view".into()],"guard-a").is_err());
            assert!(login_cached(&mut c,"alice","fixture-password").unwrap_err().contains("locked"));
        }
        {
            let mut c=rusqlite::Connection::open(&path).unwrap();ensure_auth_schema(&c).unwrap();
            assert!(login_cached(&mut c,"alice","fixture-password").is_err());
            assert_eq!(c.query_row("SELECT payload FROM sync_outbox WHERE change_id='pending-a'",[],|r|r.get::<_,String>(0)).unwrap(),"authored pending work");
            assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),2);
            assert!(login_cached(&mut c,"bob","fixture-password").is_ok());
            assert_eq!(crate::local_db::active_account(&c).unwrap(),"account-b");
            assert!(require_local_permission(&c,"notes.view").is_ok());
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn stale_native_guard_cannot_lock_or_refresh_a_new_login(){
        let mut c=rusqlite::Connection::open_in_memory().unwrap();revoked_fixture(&c);
        c.execute("UPDATE local_session SET session_token='new-login' WHERE id=1",[]).unwrap();
        assert!(!invalidate_authorization(&mut c,"account-a","guard-a").unwrap());
        assert!(refresh_permissions(&c,"account-a","admin",&vec!["users.edit".into()],"guard-a").is_err());
        assert!(require_local_permission(&c,"notes.view").is_ok());
        assert!(require_local_permission(&c,"users.edit").is_err());
        assert!(invalidate_authorization(&mut c,"account-a","new-login").unwrap());
        assert!(!invalidate_authorization(&mut c,"account-a","new-login").unwrap());
    }

    #[test]
    fn authorization_lock_rolls_back_on_session_write_failure(){
        let mut c=rusqlite::Connection::open_in_memory().unwrap();revoked_fixture(&c);
        c.execute_batch("CREATE TRIGGER fail_session_delete BEFORE DELETE ON local_session BEGIN SELECT RAISE(ABORT,'fixture write failure'); END;").unwrap();
        assert!(invalidate_authorization(&mut c,"account-a","guard-a").is_err());
        assert!(require_local_permission(&c,"notes.view").is_ok());
        assert_eq!(authorization_guard(&c,"account-a").unwrap().as_deref(),Some("guard-a"));
    }

    #[test]
    #[ignore="requires actual LabOS PostgreSQL/API and LABOS_AUTH_DESKTOP_PROBE=1"]
    fn postgres_revocation_locks_disk_cache_and_preserves_pending_author(){
        assert_eq!(std::env::var("LABOS_AUTH_DESKTOP_PROBE").as_deref(),Ok("1"));
        fn fixture(action:&str,id:&str)->serde_json::Value{
            let out=std::process::Command::new("docker").args(["exec","-e","LABOS_AUTH_DESKTOP_PROBE=1","labos-labos-api-1","node","src/phase2-auth-desktop-fixture.mjs",action,id]).output().unwrap();
            assert!(out.status.success(),"{}",String::from_utf8_lossy(&out.stderr));
            serde_json::from_slice(&out.stdout).unwrap()
        }
        struct Cleanup{path:std::path::PathBuf,account:String}
        impl Drop for Cleanup{fn drop(&mut self){
            let _=std::panic::catch_unwind(||fixture("cleanup",&self.account));
            let _=std::fs::remove_file(&self.path);
        }}
        let account=uuid::Uuid::new_v4().to_string();
        let server=fixture("create",&account);
        let path=std::env::temp_dir().join(format!("labos-real-revocation-{}.sqlite",uuid::Uuid::new_v4()));
        let _cleanup=Cleanup{path:path.clone(),account:account.clone()};
        let username=server["username"].as_str().unwrap();let password=server["password"].as_str().unwrap();
        let verified=tauri::async_runtime::block_on(crate::native_authorization::login(username,password)).unwrap();
        let token=verified.token.clone();
        let mut c=rusqlite::Connection::open(&path).unwrap();revoked_fixture(&c);
        c.execute("UPDATE local_users SET central_user_id=?1,username=?2 WHERE id='local-a'",params![account,username]).unwrap();
        c.execute("UPDATE sync_outbox SET account_id=?1 WHERE change_id='pending-a'",params![account]).unwrap();
        let generation=advance_generation(&c).unwrap();
        let published=publish_verified_login(&mut c,verified,password,generation).unwrap();
        assert_eq!(published["user"]["role"],"member");
        assert!(require_local_permission(&c,"users.manage_permissions").is_err());
        assert!(login_cached(&mut c,username,password).is_ok());
        let guard=authorization_guard(&c,&account).unwrap().unwrap();
        assert_eq!(crate::local_system::live_tests::http("GET","/auth/me",serde_json::Value::Null,&token,"")["status"],200);
        assert_eq!(fixture("disable",&account)["credential_version"],1);
        let response=crate::local_system::live_tests::http("GET","/auth/me",serde_json::Value::Null,&token,"");
        assert_eq!(response["status"],401);assert_eq!(response["body"]["error"]["code"],"ACCOUNT_DISABLED");
        assert!(invalidate_authorization(&mut c,&account,&guard).unwrap());drop(c);
        let mut c=rusqlite::Connection::open(&path).unwrap();ensure_auth_schema(&c).unwrap();
        assert!(login_cached(&mut c,username,password).is_err());
        assert!(crate::local_db::active_account(&c).is_err());
        assert_eq!(c.query_row("SELECT account_id FROM sync_outbox WHERE change_id='pending-a'",[],|r|r.get::<_,String>(0)).unwrap(),account);
        assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        assert!(login_cached(&mut c,"bob","fixture-password").is_ok());
        println!("PASS native password/permission exchange against actual PostgreSQL -> atomic disk-cache publication -> disable/JWT rejection -> restart denial, pending author preservation and unaffected second cached account.");
    }

    #[test]
    fn local_user_projection_uses_central_identity_without_changing_session_owner() {
        let c=rusqlite::Connection::open_in_memory().unwrap();
        ensure_auth_schema(&c).unwrap();
        c.execute("INSERT INTO local_users(id,central_user_id,username,password_hash,role,last_server_auth_at,offline_expires_at) VALUES('private-row','central-account','fixture','unused','member',CURRENT_TIMESTAMP,datetime('now','+7 days'))",[]).unwrap();
        c.execute("INSERT INTO local_session(id,user_id,session_token) VALUES(1,'private-row','opaque')",[]).unwrap();
        let user=c.query_row("SELECT id,central_user_id,username,role,display_name,email,is_active,offline_expires_at FROM local_users",[],map_user).unwrap();
        assert_eq!(user.id,"central-account");
        assert_eq!(crate::local_db::active_account(&c).unwrap(),user.id);
        assert_eq!(c.query_row("SELECT user_id FROM local_session",[],|r|r.get::<_,String>(0)).unwrap(),"private-row");
    }

    #[test]
    fn privileged_leases_expire_without_losing_pending_work() {
        let c=rusqlite::Connection::open_in_memory().unwrap();
        ensure_auth_schema(&c).unwrap();
        c.execute("INSERT INTO local_users(id,central_user_id,username,password_hash,role,permissions_json,last_server_auth_at,offline_expires_at) VALUES('a','server-a','alice','unused','admin','[\"notes.create\"]',datetime('now','-25 hours'),datetime('now','+6 days'))",[]).unwrap();
        c.execute("INSERT INTO local_session VALUES(1,'a','token',CURRENT_TIMESTAMP)",[]).unwrap();
        enforce_offline_lease_bounds(&c).unwrap();
        assert!(require_local_permission(&c,"notes.create").is_err());
        let before:String=c.query_row("SELECT offline_expires_at FROM local_users",[],|r|r.get(0)).unwrap();
        // A role downgrade or repeated startup cannot extend an expired lease.
        c.execute("UPDATE local_users SET role='member'",[]).unwrap();
        enforce_offline_lease_bounds(&c).unwrap();
        let after:String=c.query_row("SELECT offline_expires_at FROM local_users",[],|r|r.get(0)).unwrap();
        assert_eq!(before,after);
        assert_eq!(c.query_row("SELECT COUNT(*) FROM local_users",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    }

    #[test]
    fn ordinary_and_delegated_privileged_accounts_have_distinct_leases() {
        assert_eq!(offline_lease_modifier("member",&vec!["notes.create".into()]),"+7 days");
        assert_eq!(offline_lease_modifier("admin",&vec![]),"+24 hours");
        assert_eq!(offline_lease_modifier("member",&vec!["users.manage_permissions".into()]),"+24 hours");
        let c=rusqlite::Connection::open_in_memory().unwrap();
        ensure_auth_schema(&c).unwrap();
        c.execute("INSERT INTO local_users(id,central_user_id,username,password_hash,role,permissions_json,last_server_auth_at,offline_expires_at) VALUES('m','server-m','member','unused','member','[\"notes.create\"]',datetime('now','-25 hours'),datetime('now','+6 days'))",[]).unwrap();
        c.execute("INSERT INTO local_session VALUES(1,'m','token',CURRENT_TIMESTAMP)",[]).unwrap();
        enforce_offline_lease_bounds(&c).unwrap();
        assert!(require_local_permission(&c,"notes.create").is_ok());
        c.execute("UPDATE local_users SET permissions_json='[\"notes.create\",\"users.manage_permissions\"]'",[]).unwrap();
        enforce_offline_lease_bounds(&c).unwrap();
        assert!(require_local_permission(&c,"notes.create").is_err());
        c.execute("UPDATE local_users SET last_server_auth_at=NULL,offline_expires_at='2099-01-01'",[]).unwrap();
        enforce_offline_lease_bounds(&c).unwrap();
        assert!(require_local_permission(&c,"notes.create").is_err());
    }
}
