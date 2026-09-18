use argon2::{Argon2, PasswordHash, PasswordVerifier};
use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::AppHandle;
use crate::local_db::open_local_connection;

#[derive(Debug, Serialize)]
pub struct LocalUser { pub id: String, pub username: String, pub role: String, pub display_name: Option<String>, pub email: Option<String>, pub is_active: bool }

fn ensure_auth_schema(c: &rusqlite::Connection) -> Result<(), String> {
    c.execute_batch(r#"
      CREATE TABLE IF NOT EXISTS local_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        display_name TEXT,
        email TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS local_session (
        id INTEGER PRIMARY KEY CHECK(id=1),
        user_id TEXT NOT NULL,
        session_token TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    "#).map_err(|e| format!("Unable to initialize local auth schema: {e}"))
}
fn map_user(r:&rusqlite::Row)->rusqlite::Result<LocalUser>{
    Ok(LocalUser{id:r.get(0)?,username:r.get(1)?,role:r.get(2)?,display_name:r.get(3)?,email:r.get(4)?,is_active:r.get::<_,i64>(5)?!=0})
}
fn hash_password(password:&str)->Result<String,String>{
    let salt=SaltString::generate(&mut OsRng);
    Argon2::default().hash_password(password.as_bytes(),&salt).map(|h|h.to_string()).map_err(|e|format!("Unable to hash password: {e}"))
}
fn verify_password(password:&str,hash:&str)->Result<bool,String>{
    let parsed=PasswordHash::new(hash).map_err(|e|format!("Invalid stored password hash: {e}"))?;
    Ok(Argon2::default().verify_password(password.as_bytes(),&parsed).is_ok())
}
fn session_token()->String{format!("{}{}",uuid::Uuid::new_v4(),uuid::Uuid::new_v4())}

#[tauri::command]
pub fn local_auth_status(app:AppHandle)->Result<serde_json::Value,String>{
    let c=open_local_connection(&app)?; ensure_auth_schema(&c)?;
    let count:i64=c.query_row("SELECT COUNT(*) FROM local_users",[],|r|r.get(0)).map_err(|e|format!("Unable to inspect local administrator: {e}"))?;
    let user= c.query_row("SELECT id,username,role,display_name,email,is_active FROM local_users WHERE id=(SELECT user_id FROM local_session WHERE id=1)",[],map_user).optional().map_err(|e|format!("Unable to inspect local session: {e}"))?;
    Ok(serde_json::json!({"bootstrapped":count>0,"authenticated":user.is_some(),"user":user}))
}
#[tauri::command]
pub fn bootstrap_local_admin(app:AppHandle,username:String,password:String)->Result<serde_json::Value,String>{
    if username.trim().len()<3||username.trim().len()>64{return Err("Username must be between 3 and 64 characters".into())}
    if password.len()<8||password.len()>128{return Err("Password must be between 8 and 128 characters".into())}
    let mut c=open_local_connection(&app)?;ensure_auth_schema(&c)?;
    let count:i64=c.query_row("SELECT COUNT(*) FROM local_users",[],|r|r.get(0)).map_err(|e|format!("Unable to inspect local users: {e}"))?;
    if count>0{return Err("Local administrator is already configured".into())}
    let id=uuid::Uuid::new_v4().to_string();let hash=hash_password(&password)?;let token=session_token();
    let tx=c.transaction().map_err(|e|format!("Unable to start local bootstrap: {e}"))?;
    tx.execute("INSERT INTO local_users(id,username,password_hash,role) VALUES(?1,?2,?3,'admin')",params![id,username.trim(),hash]).map_err(|e|format!("Unable to create local administrator: {e}"))?;
    tx.execute("INSERT INTO local_session(id,user_id,session_token) VALUES(1,?1,?2)",params![id,token]).map_err(|e|format!("Unable to create local session: {e}"))?;
    tx.commit().map_err(|e|format!("Unable to commit local bootstrap: {e}"))?;
    Ok(serde_json::json!({"user":{"id":id,"username":username.trim(),"role":"admin"},"token":token}))
}
#[tauri::command]
pub fn local_login(app:AppHandle,username:String,password:String)->Result<serde_json::Value,String>{
    let mut c=open_local_connection(&app)?;ensure_auth_schema(&c)?;
    let row=c.query_row("SELECT id,username,password_hash,role,display_name,email,is_active FROM local_users WHERE username=?1",params![username.trim()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,i64>(6)?))).optional().map_err(|e|format!("Unable to read local administrator: {e}"))?.ok_or("Invalid credentials")?;
    if row.6==0{return Err("Account is disabled".into())} if !verify_password(&password,&row.2)?{return Err("Invalid credentials".into())}
    let token=session_token();c.execute("INSERT INTO local_session(id,user_id,session_token) VALUES(1,?1,?2) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,session_token=excluded.session_token",params![row.0,token]).map_err(|e|format!("Unable to create local session: {e}"))?;
    Ok(serde_json::json!({"user":{"id":row.0,"username":row.1,"role":row.3,"display_name":row.4,"email":row.5,"is_active":true},"token":token}))
}
#[tauri::command]
pub fn local_current_user(app:AppHandle)->Result<Option<LocalUser>,String>{
    let c=open_local_connection(&app)?;ensure_auth_schema(&c)?;
    c.query_row("SELECT u.id,u.username,u.role,u.display_name,u.email,u.is_active FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1",[],map_user).optional().map_err(|e|format!("Unable to read local session: {e}"))
}
#[tauri::command]
pub fn local_logout(app:AppHandle)->Result<(),String>{let c=open_local_connection(&app)?;ensure_auth_schema(&c)?;c.execute("DELETE FROM local_session WHERE id=1",[]).map_err(|e|format!("Unable to clear local session: {e}"))?;Ok(())}
#[tauri::command]
pub fn local_change_password(app:AppHandle,current_password:String,new_password:String)->Result<(),String>{
    if new_password.len()<8||new_password.len()>128{return Err("New password must be between 8 and 128 characters".into())}
    let c=open_local_connection(&app)?;ensure_auth_schema(&c)?;
    let uid:String=c.query_row("SELECT user_id FROM local_session WHERE id=1",[],|r|r.get(0)).optional().map_err(|e|format!("Unable to read local session: {e}"))?.ok_or("Not authenticated")?;
    let hash:String=c.query_row("SELECT password_hash FROM local_users WHERE id=?1 AND is_active=1",params![uid],|r|r.get(0)).map_err(|e|format!("Unable to read local password: {e}"))?;
    if !verify_password(&current_password,&hash)?{return Err("Current password is incorrect".into())}
    if current_password==new_password{return Err("New password must differ from the current password".into())}
    let new_hash=hash_password(&new_password)?;c.execute("UPDATE local_users SET password_hash=?1 WHERE id=?2",params![new_hash,uid]).map_err(|e|format!("Unable to update local password: {e}"))?;Ok(())
}
#[tauri::command]
pub fn local_update_profile(app:AppHandle,display_name:Option<String>,email:Option<String>)->Result<LocalUser,String>{
    let c=open_local_connection(&app)?;ensure_auth_schema(&c)?;
    let uid:String=c.query_row("SELECT user_id FROM local_session WHERE id=1",[],|r|r.get(0)).optional().map_err(|e|format!("Unable to read local session: {e}"))?.ok_or("Not authenticated")?;
    let display=display_name.map(|v|v.trim().to_string()).filter(|v|!v.is_empty());let mail=email.map(|v|v.trim().to_lowercase()).filter(|v|!v.is_empty());
    if display.as_ref().is_some_and(|v|v.len()>120){return Err("Display name must be 120 characters or fewer".into())}
    if mail.as_ref().is_some_and(|v|v.len()>254||!v.contains('@')){return Err("Email is invalid".into())}
    c.execute("UPDATE local_users SET display_name=?1,email=?2 WHERE id=?3",params![display,mail,uid]).map_err(|e|format!("Unable to update local profile: {e}"))?;
    c.query_row("SELECT id,username,role,display_name,email,is_active FROM local_users WHERE id=?1",params![uid],map_user).map_err(|e|format!("Unable to read updated profile: {e}"))
}
