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
    Ok(())
}

fn map_user(r:&rusqlite::Row)->rusqlite::Result<LocalUser>{
    Ok(LocalUser{
        id:r.get(0)?,
        central_user_id:r.get(1)?,
        username:r.get(2)?,
        role:r.get(3)?,
        display_name:r.get(4)?,
        email:r.get(5)?,
        is_active:r.get::<_,i64>(6)?!=0,
        offline_expires_at:r.get(7)?,
    })
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

#[tauri::command]
pub fn local_auth_status(app:AppHandle)->Result<serde_json::Value,String>{
    let c=open_local_connection(&app)?; ensure_auth_schema(&c)?;
    let count:i64=c.query_row(
        "SELECT COUNT(*) FROM local_users WHERE central_user_id IS NOT NULL AND is_active=1",
        [],|r|r.get(0)
    ).map_err(|e|format!("Unable to inspect cached accounts: {e}"))?;
    let user=c.query_row(
        "SELECT id,central_user_id,username,role,display_name,email,is_active,offline_expires_at FROM local_users WHERE id=(SELECT user_id FROM local_session WHERE id=1)",
        [],map_user
    ).optional().map_err(|e|format!("Unable to inspect local session: {e}"))?;
    Ok(serde_json::json!({"bootstrapped":count>0,"authenticated":user.is_some(),"user":user}))
}

#[tauri::command]
pub fn cache_server_user(
    app:AppHandle,
    central_user_id:String,
    username:String,
    password:String,
    role:String,
    display_name:Option<String>,
    email:Option<String>,
    permissions:Vec<String>
)->Result<serde_json::Value,String>{
    if central_user_id.trim().is_empty(){return Err("Central user ID is required".into())}
    if username.trim().len()<3||username.trim().len()>64{return Err("Username must be between 3 and 64 characters".into())}
    if password.len()<8||password.len()>128{return Err("Password must be between 8 and 128 characters".into())}
    let mut c=open_local_connection(&app)?;ensure_auth_schema(&c)?;
    let hash=hash_password(&password)?;
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
            "UPDATE local_users SET central_user_id=?1,username=?2,password_hash=?3,role=?4,display_name=?5,email=?6,is_active=1,permissions_json=?7,last_server_auth_at=CURRENT_TIMESTAMP,offline_expires_at=datetime('now','+7 days') WHERE id=?8",
            params![central_user_id.trim(),username.trim(),hash,role,display_name,email,permissions_json,local_id]
        ).map_err(|e|format!("Unable to update cached server account: {e}"))?;
    } else {
        c.execute(
            "INSERT INTO local_users(id,central_user_id,username,password_hash,role,display_name,email,is_active,permissions_json,last_server_auth_at,offline_expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,1,?8,CURRENT_TIMESTAMP,datetime('now','+7 days'))",
            params![local_id,central_user_id.trim(),username.trim(),hash,role,display_name,email,permissions_json]
        ).map_err(|e|format!("Unable to cache server account: {e}"))?;
    }
    c.execute(
        "INSERT INTO local_session(id,user_id,session_token) VALUES(1,?1,?2)
         ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,session_token=excluded.session_token",
        params![local_id,token]
    ).map_err(|e|format!("Unable to create local session: {e}"))?;
    Ok(serde_json::json!({"user":{
        "id":local_id,"central_user_id":central_user_id.trim(),"username":username.trim(),
        "role":role,"display_name":display_name,"email":email,"is_active":true,
        "offline_expires_at":c.query_row("SELECT offline_expires_at FROM local_users WHERE id=?1",params![local_id],|r|r.get::<_,String>(0)).unwrap_or_default()
    },"token":token}))
}

#[tauri::command]
pub fn local_login(app:AppHandle,username:String,password:String)->Result<serde_json::Value,String>{
    let c=open_local_connection(&app)?;ensure_auth_schema(&c)?;
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

    if row.7==0{return Err("Account is disabled".into())}
    if !verify_password(&password,&row.3)?{return Err("Invalid credentials".into())}
    let expires=row.8.clone().ok_or("Offline access is not available. Connect to LabOS to sign in.")?;
    let valid= c.query_row(
        "SELECT CASE WHEN datetime('now') < datetime(?1) THEN 1 ELSE 0 END",
        params![expires],|r|r.get::<_,i64>(0)
    ).unwrap_or(0);
    if valid==0{return Err("Offline access has expired. Connect to LabOS to sign in again.".into())}

    let token=session_token();
    c.execute(
        "INSERT INTO local_session(id,user_id,session_token) VALUES(1,?1,?2)
         ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,session_token=excluded.session_token",
        params![row.0,token]
    ).map_err(|e|format!("Unable to create local session: {e}"))?;
    Ok(serde_json::json!({"user":{
        "id":row.0,"central_user_id":row.1,"username":row.2,"role":row.4,
        "display_name":row.5,"email":row.6,"is_active":true,"offline_expires_at":row.8
    },"token":format!("local:{token}")}))
}

#[tauri::command]
pub fn local_current_user(app:AppHandle)->Result<Option<LocalUser>,String>{
    let c=open_local_connection(&app)?;ensure_auth_schema(&c)?;
    c.query_row(
        "SELECT u.id,u.central_user_id,u.username,u.role,u.display_name,u.email,u.is_active,u.offline_expires_at
         FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1 AND u.central_user_id IS NOT NULL AND u.is_active=1",
        [],map_user
    ).optional().map_err(|e|format!("Unable to read local session: {e}"))
}

#[tauri::command]
pub fn cache_server_permissions(app:AppHandle,central_user_id:String,role:String,permissions:Vec<String>)->Result<(),String>{
    let c=open_local_connection(&app)?;ensure_auth_schema(&c)?;
    let permissions_json=serde_json::to_string(&permissions).map_err(|e|format!("Unable to encode permissions: {e}"))?;
    let updated=c.execute(
        "UPDATE local_users SET role=?1,permissions_json=?2,last_server_auth_at=CURRENT_TIMESTAMP,offline_expires_at=datetime('now','+7 days'),is_active=1 WHERE central_user_id=?3",
        params![role,permissions_json,central_user_id.trim()]
    ).map_err(|e|format!("Unable to refresh cached permissions: {e}"))?;
    if updated==0{return Err("Central account is not cached on this installation".into())}
    Ok(())
}

#[tauri::command]
pub fn local_current_permissions(app:AppHandle)->Result<Vec<String>,String>{
    let c=open_local_connection(&app)?;ensure_auth_schema(&c)?;
    let permissions:String=c.query_row(
        "SELECT u.permissions_json FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1",
        [],|r|r.get(0)
    ).optional().map_err(|e|format!("Unable to read local permissions: {e}"))?
     .ok_or("Not authenticated")?;
    serde_json::from_str(&permissions).map_err(|e|format!("Unable to decode local permissions: {e}"))
}

#[tauri::command]
pub fn local_logout(app:AppHandle)->Result<(),String>{
    let c=open_local_connection(&app)?;ensure_auth_schema(&c)?;
    c.execute("DELETE FROM local_session WHERE id=1",[])
        .map_err(|e|format!("Unable to clear local session: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn local_change_password(_app:AppHandle,_current_password:String,_new_password:String)->Result<(),String>{
    Err("Password changes require an online LabOS connection.".into())
}

#[tauri::command]
pub fn local_update_profile(_app:AppHandle,_display_name:Option<String>,_email:Option<String>)->Result<LocalUser,String>{
    Err("Profile changes require an online LabOS connection.".into())
}
