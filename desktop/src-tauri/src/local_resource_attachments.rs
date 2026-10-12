use rusqlite::{params, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::AppHandle;
use crate::{local_auth, local_db, local_resources};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Destination {
    item_id: Option<String>,
    project_id: Option<String>,
    note_id: Option<String>,
}

impl Destination {
    fn normalize(&mut self) -> Result<(), String> {
        let mut count = 0;
        for value in [&mut self.item_id, &mut self.project_id, &mut self.note_id] {
            if let Some(id) = value {
                *id = uuid::Uuid::parse_str(id).map_err(|_| "Invalid attachment ID")?.to_string();
                count += 1;
            }
        }
        if count > 1 { return Err("Choose only one attachment destination".into()); }
        Ok(())
    }
}

pub(crate) fn require_cached_resource_editor(conn: &rusqlite::Connection, resource: &local_resources::LocalResource) -> Result<(), String> {
    local_auth::require_local_permission(conn, "resources.view")?;
    local_auth::require_local_permission(conn, "resources.edit")?;
    let role: String = conn.query_row("SELECT u.role FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if role != "admin" {
        if resource.visibility.as_deref() == Some("restricted") || resource.note_id.is_some() || resource.parent_resource_id.is_some() {
            return Err("This action requires record edit authority that is not cached on this PC yet".into());
        }
        let project = resource.project_id.as_deref().ok_or("Shared-resource edit authority is not cached on this PC yet")?;
        crate::local_projects::require_cached_project_access(conn, project, true)?;
    }
    Ok(())
}

#[tauri::command]
pub fn move_local_resource_attachment(app: AppHandle, expected_account_id: String,
    expected_session_token: String, resource_id: String, mut destination: Destination,
) -> Result<local_resources::LocalResource, String> {
    destination.normalize()?;
    let id = uuid::Uuid::parse_str(&resource_id).map_err(|_| "Invalid resource ID")?.to_string();
    let mut conn = local_db::open_local_connection(&app)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    local_db::require_sync_account(&tx, &expected_account_id)?;
    local_auth::require_local_permission(&tx, "resources.view")?;
    local_auth::require_local_permission(&tx, "resources.edit")?;
    let token: String = tx.query_row("SELECT session_token FROM local_session WHERE id=1",
        [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if token != expected_session_token { return Err("Session changed while moving resource".into()); }
    let mut resources = local_resources::read_resources(&tx)?;
    let resource = resources.iter_mut().find(|r| r.id == id).ok_or("Resource unavailable on this PC")?;
    if resource.parent_resource_id.is_some() || resource.kind == "folder" {
        return Err("Folder trees and nested resources require folder management".into());
    }
    // Until uploader identity and record edit grants are cached, a visible row
    // alone is not enough authority for a non-admin shared/restricted move.
    require_cached_resource_editor(&tx, resource)?;
    crate::local_resource_uploads::parent_guard(&tx, &serde_json::to_value(&destination).map_err(|e| e.to_string())?)?;
    if resource.visibility.as_deref() == Some("project") && destination.project_id.is_none() {
        return Err("Keep this project-visible resource attached to a project; note-project authority is not cached here yet".into());
    }
    let denied: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_resource_poster_denials')", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if denied {
        let revoked: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_poster_denials WHERE account_id=?1 AND resource_id=?2)",
            params![expected_account_id, id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if revoked { return Err("Resource access was revoked; the move has not been saved".into()); }
    }
    if resource.item_id == destination.item_id && resource.project_id == destination.project_id && resource.note_id == destination.note_id {
        return Ok(resource.clone());
    }
    let pending: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM active_sync_outbox WHERE synced_at IS NULL AND entity_type='resource' AND entity_id=?1)",
        [&id], |r| r.get(0)).map_err(|e| e.to_string())?;
    if pending { return Err("This resource has an unsynchronized change. Keep it saved and sync before moving it again".into()); }
    let revision = resource.updated_at.clone();
    resource.item_id = destination.item_id.clone();
    resource.project_id = destination.project_id.clone();
    resource.note_id = destination.note_id.clone();
    resource.item_name = None; resource.project_name = None; resource.note_title = None;
    // Keep the confirmed revision: moving metadata must not pretend file bytes
    // have changed. The authoritative revision arrives in the next server pull.
    let result = resource.clone();
    local_resources::write_resources(&tx, &resources)?;
    let device: String = tx.query_row("SELECT device_id FROM device_identity WHERE id=1", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    let payload = json!({"id":id,"attachment":{"protocol":1,"expected_updated_at":revision,"destination":destination}});
    tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'resource',?3,'attach',?4)",
        params![uuid::Uuid::new_v4().to_string(),device,id,payload.to_string()]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn destination_is_single_parent_canonical_and_strict() {
        let mut d: Destination = serde_json::from_value(json!({"project_id":"AAFFBBCC00112233445566778899AABB"})).unwrap();
        d.normalize().unwrap();
        assert_eq!(d.project_id.as_deref(), Some("aaffbbcc-0011-2233-4455-66778899aabb"));
        d.item_id = d.project_id.clone();
        assert!(d.normalize().is_err());
        assert!(serde_json::from_value::<Destination>(json!({"parent_resource_id":null})).is_err());
    }
}
