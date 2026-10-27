//! Explicit, view-only handoff of a verified local presentation to the OS.
use std::{fs, io::Read};
use tauri::{AppHandle, Manager};
use crate::{local_db, local_resources, local_resource_uploads};

fn extension(name: &str) -> Result<&'static str, String> {
    match name.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "ppt" => Ok("ppt"),
        "pptx" => Ok("pptx"),
        _ => Err("Only .ppt and .pptx presentations can be opened externally here".into()),
    }
}

#[tauri::command]
pub fn open_local_presentation(app: AppHandle, expected_account_id: String,
    expected_session_token: String, resource_id: String) -> Result<(), String> {
    let c = local_db::open_local_connection(&app)?;
    let authorize = || -> Result<(), String> {
        local_db::require_sync_account(&c, &expected_account_id)?;
        crate::local_auth::require_local_permission(&c, "resources.view")?;
        let token: String = c.query_row("SELECT session_token FROM local_session WHERE id=1", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        if token != expected_session_token { return Err("Session changed; reopen the resource".into()); }
        Ok(())
    };
    authorize()?;
    let record = local_resources::read_resources(&c)?.into_iter().find(|r| r.id == resource_id).ok_or("Resource unavailable")?;
    if record.kind != "file" { return Err("Only uploaded presentations can be opened".into()); }
    let ext = extension(record.original_filename.as_deref().unwrap_or(&record.name))?;
    let (source, _, size) = local_resource_uploads::resolved_file(&app, &c, &resource_id)
        .map_err(|_| "This file is not available on this PC yet. Connect and synchronize first.")?;
    if size > 500 * 1024 * 1024 { return Err("Presentation exceeds the 500 MiB opening limit".into()); }
    // Never pass renderer paths, URLs, arbitrary extensions or arguments to the OS.
    // A new copy also prevents external saves from corrupting managed sync bytes.
    let folder = std::env::temp_dir().join(format!("labos-presentation-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&folder).map_err(|e| e.to_string())?;
    let target = folder.join(format!("Presentation.{ext}"));
    let result = (|| -> Result<(), String> {
        let mut input = fs::File::open(&source).map_err(|e| e.to_string())?.take(size + 1);
        let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|e| e.to_string())?;
        if std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())? != size {
            return Err("Presentation changed while copying; please retry".into());
        }
        output.sync_all().map_err(|e| e.to_string())?;
        drop(output);
        authorize()?;
        let current = local_resources::read_resources(&c)?.into_iter().find(|r| r.id == resource_id).ok_or("Resource unavailable")?;
        if current.updated_at != record.updated_at || local_resource_uploads::resolved_file(&app, &c, &resource_id)?.0 != source {
            return Err("Resource changed; refresh before opening".into());
        }
        tauri::api::shell::open(&app.shell_scope(), target.to_string_lossy().into_owned(), None)
            .map_err(|_| "Could not open the presentation. Install or choose a default app for PowerPoint files, then retry.".to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(&target); let _ = fs::remove_dir(&folder); }
    // Successful copies remain in OS temporary storage: the external app may
    // still be reading them. They are not synced and cannot be revoked remotely.
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_presentation_extensions_are_allowed() {
        assert_eq!(extension("Slides.PPTX").unwrap(), "pptx");
        assert_eq!(extension("legacy.ppt").unwrap(), "ppt");
        for name in ["slides.pptx.exe", "slides.pptm", "pptx.exe", "file", "slides.pptx "] {
            assert!(extension(name).is_err(), "{name}");
        }
    }
}
