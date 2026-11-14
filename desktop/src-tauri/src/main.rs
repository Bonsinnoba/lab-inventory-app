#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod responsive_reads;
mod performance_probe;
#[cfg(feature="working-encryption")]
mod encrypted_database;
mod sqlite_snapshot;
mod local_db;
mod startup;
mod profile_recovery;
mod recovery_retention;
mod managed_encryption;
mod working_store;
mod working_migration;
#[cfg(test)]
#[path="../security_policy.rs"]
mod security_policy;
mod recovery_crypto;
mod recovery_protection;
mod recovery_archive;
mod local_recovery;
mod protected_credentials;
mod local_purchases;
mod local_profiles;
mod local_managed_users;
mod local_auth;
mod native_authorization;
mod local_inventory;
mod local_reservations;
mod local_salvage;
mod local_project_review;
mod inventory_sync_state;
mod local_finance;
mod local_inventory_cache;
mod local_projects;
mod local_notes;
mod local_knowledge;
mod local_locations;
mod local_resources;
mod local_presentations;
mod local_search;
mod local_excel;
mod local_system;
mod local_maintenance;
mod local_catalog;
mod local_notifications;
mod local_automation;
mod local_proposals;
mod local_activity;
mod local_downloads;
mod local_resource_posters;
mod local_resource_uploads;
mod local_resource_replication;
mod local_resource_attachments;
mod local_resource_tree_moves;
mod local_resource_recovery;
mod local_resource_storage;
mod local_resource_edits;
mod resource_dependencies;
mod resource_file_response;
mod local_resource_export;
mod local_resource_authority;
mod local_resource_destinations;
mod local_docx;
mod local_comments;
mod local_engineering;
use tauri::Manager;
fn main() {
    // Activate before WebView2 opens its profile files or SQLite opens WAL.
    let context=tauri::generate_context!();
    let mut profile_lease=None;
    let bootstrap=(||->Result<Option<std::path::PathBuf>,String>{let root=profile_recovery::profile_root_config(context.config())?;profile_lease=Some(profile_recovery::acquire(&root)?);let previous=profile_recovery::activate_pending(&root)?;#[cfg(feature="working-encryption")]encrypted_database::prepare_workspace(&root)?;#[cfg(not(feature="working-encryption"))]if root.join(".workspace-encryption.json").exists(){return Err("This workspace requires an encryption-enabled LabOS build. Existing work is preserved.".into())}Ok(previous)})();
    let show=tauri::CustomMenuItem::new("show".to_string(),"Show"); let hide=tauri::CustomMenuItem::new("hide".to_string(),"Hide"); let quit=tauri::CustomMenuItem::new("quit".to_string(),"Quit"); let tray_menu=tauri::SystemTrayMenu::new().add_item(show).add_item(hide).add_item(quit);
    tauri::Builder::default().setup(move|app|{app.manage(profile_recovery::Tickets::default());if let Some(lease)=profile_lease{app.manage(lease);}let initialized=(||->Result<Option<std::path::PathBuf>,String>{let previous=bootstrap?;local_db::initialize(&app.handle())?;local_inventory::initialize(&app.handle())?;Ok(previous)})();let status=match initialized{Ok(previous)=>{let mut status=startup::StartupStatus::from_initialization(Ok(()));if let Some(path)=previous{status.message=Some(format!("Recovery activated. The previous workspace is preserved at {}. Sign in again to renew access.",path.display()));}status},Err(error)=>startup::StartupStatus::from_initialization(Err(error))};app.manage(status);Ok(())}).register_uri_scheme_protocol("labos-file",local_resource_uploads::serve_file).invoke_handler(tauri::generate_handler![startup::local_startup_status,local_recovery::repair_current_workspace_key,local_recovery::activate_recovered_workspace,local_recovery::list_local_recovery_backups,local_recovery::prune_local_recovery_backup,local_recovery::standalone_recovery_status,local_recovery::cancel_standalone_recovery,local_recovery::restore_standalone_recovery_package,protected_credentials::forget_local_server_credential,local_recovery::cancel_local_recovery_operation,local_recovery::recover_local_recovery_key,local_recovery::get_local_recovery_status,local_recovery::create_local_recovery_backup,local_recovery::restore_local_recovery_package,local_resource_uploads::local_resource_file_access,local_resource_uploads::bind_local_resource_upload_receipts,local_resource_uploads::begin_local_resource_upload,local_resource_uploads::write_local_resource_upload_chunk,local_resource_uploads::finish_local_resource_upload,local_resource_uploads::finish_local_resource_upload_batch,local_resource_uploads::read_local_resource_upload_chunk,local_db::local_database_status,local_auth::local_auth_status,local_auth::cache_server_user,local_auth::local_login,local_auth::local_current_user,local_auth::local_current_permissions,local_auth::cache_server_permissions,local_auth::local_logout,local_auth::local_change_password,local_auth::local_update_profile,local_db::get_inventory_sync_cursor,local_db::save_local_snapshot_with_sync,local_db::list_pending_sync_changes,local_db::list_sync_conflicts,local_db::record_sync_conflict,local_db::resolve_sync_conflict,local_db::mark_sync_changes_synced,local_db::record_sync_failure,local_db::apply_server_inventory_pull,local_inventory::list_local_inventory_movements,local_inventory::cache_local_inventory_movements,local_inventory::save_local_inventory_movement,local_inventory::list_local_item_custody,local_inventory::cache_local_item_custody,local_inventory::list_local_assignee_directory,local_inventory::cache_local_assignee_directory,local_inventory::list_local_item_field_history,local_inventory::cache_local_item_field_history,local_inventory::list_local_item_assignment_history,local_inventory::cache_local_item_assignment_history,local_profiles::update_local_account_profile,local_profiles::refresh_native_account_profile,local_purchases::import_local_purchase_workbook,local_excel::import_local_finance_rows,local_excel::get_local_workbook_context,local_excel::get_local_workbook_export,local_excel::import_local_inventory_rows,local_inventory_cache::get_local_inventory_snapshot,local_inventory_cache::cache_local_inventory_snapshot,local_projects::list_local_projects,local_projects::get_local_project,local_projects::create_local_project,local_projects::update_local_project,local_projects::delete_local_project,local_projects::list_local_project_workspace,local_projects::get_local_project_canvas,local_projects::create_local_project_block,local_projects::update_local_project_block,local_projects::delete_local_project_block,local_projects::create_local_project_connector,local_projects::delete_local_project_connector,local_projects::create_local_project_task,
        local_projects::get_local_project_task_experiments,
        local_managed_users::get_local_managed_users,
        local_managed_users::refresh_native_managed_users,
        local_managed_users::get_local_user_permission_profile,
        local_managed_users::refresh_native_user_permission_profile,
        local_db::list_project_delete_recoveries,
        local_db::get_local_sync_queue_status,
        local_inventory::save_local_inventory_custody_movement,
        local_reservations::save_local_reservation_intent,
        local_salvage::get_local_salvage_snapshot,
        local_salvage::get_local_salvage_sources,
        local_salvage::get_local_salvage_custody_sources,
        local_salvage::apply_server_salvage_pull,
        local_salvage::save_local_salvage_intent,
        local_project_review::save_local_project_review_intent,
        local_auth::local_authorization_guard,
        local_resource_authority::refresh_local_resource_authority,
        local_resource_authority::confirm_local_resource_changes,
        local_resource_authority::confirm_local_resource_mutation,
        local_auth::invalidate_local_authorization,
        local_maintenance::list_local_maintenance,
        local_comments::list_local_comments,
        local_comments::mutate_local_comment,
        local_comments::apply_server_comments_pull,
        local_proposals::save_local_assistant_proposal,
        local_proposals::accept_local_assistant_proposal,
        local_proposals::list_local_assistant_proposals,
        local_proposals::acknowledge_local_assistant_proposal,
        local_proposals::apply_server_assistant_proposals,
        local_automation::queue_local_automation_run,
        local_automation::get_local_automation_state,
        local_automation::acknowledge_local_automation_run,
        local_notifications::list_local_notifications,
        local_activity::list_local_activity,
        local_downloads::get_local_download_snapshot,
        local_resource_posters::read_local_resource_poster,
        local_presentations::open_local_presentation,
        local_resource_export::export_local_resource_file,
        local_resource_replication::replicate_local_resource,
        local_resource_replication::local_resource_copy_status,
        performance_probe::local_performance_probe,
        local_resource_attachments::move_local_resource_attachment,
        local_resource_storage::manage_local_resource_storage,
        local_resource_recovery::read_local_resource_recovery_details,
        local_resource_recovery::list_local_resource_recovery,
            local_resource_recovery::export_local_resource_recovery,
            local_resource_tree_moves::prepare_local_resource_tree_move,
        local_resource_tree_moves::move_local_resource_tree,
        local_resource_uploads::read_local_resource_markdown,
        local_resource_uploads::create_local_pdf_edit_copy,
        local_docx::read_local_docx,
        local_docx::save_local_docx_copy,
        local_resource_edits::save_local_resource_markdown,
        local_resource_edits::begin_local_pdf_replacement,
        local_resource_edits::write_local_pdf_replacement_chunk,
        local_resource_edits::finish_local_pdf_replacement,
        local_resource_edits::list_local_markdown_versions,
        local_resource_edits::read_local_markdown_version,
        local_resource_edits::read_local_resource_edit_chunk,
        local_resource_edits::bind_local_resource_edit_receipts,
        local_resource_posters::cache_local_resource_poster,
        local_downloads::queue_local_download,
        local_downloads::control_local_download,
        local_downloads::save_local_download_settings,
        local_downloads::apply_server_download_snapshot,
        local_downloads::acknowledge_local_download_changes,
        local_activity::apply_server_activity_snapshot,
        local_notifications::mark_local_notifications_read,
        local_notifications::apply_server_notifications_pull,
        local_catalog::list_local_catalog,
        local_catalog::mutate_local_catalog,
        local_catalog::apply_server_catalog_pull,
        local_maintenance::mutate_local_maintenance,
        local_maintenance::apply_server_maintenance_pull,
        local_system::apply_server_daily_preferences,
        local_projects::create_local_project_task_experiment,
        local_projects::delete_local_project_task_experiment,
        local_projects::get_local_project_attachments,
        local_projects::create_local_project_attachment,
        local_projects::delete_local_project_attachment,local_projects::update_local_project_task,local_projects::delete_local_project_task,local_projects::create_local_project_experiment,local_projects::create_local_project_experiment_measurement,local_projects::delete_local_project_experiment_measurement,local_projects::create_local_project_experiment_observation,local_projects::delete_local_project_experiment_observation,local_projects::update_local_project_experiment,local_projects::delete_local_project_experiment,local_projects::repeat_local_project_experiment,local_projects::create_local_project_bom,local_projects::update_local_project_bom,local_projects::delete_local_project_bom,local_projects::get_local_project_tasks,local_projects::get_local_project_experiments,local_projects::get_local_project_bom,local_projects::get_local_resource_requirements,local_projects::create_local_resource_requirement,local_projects::update_local_resource_requirement,local_projects::delete_local_resource_requirement,local_projects::link_local_project_item,local_projects::unlink_local_project_item,local_projects::apply_server_project_pull,local_notes::list_local_notes,local_notes::get_local_note_tags,local_notes::get_local_note,local_notes::create_local_note,local_notes::update_local_note,local_notes::delete_local_note,local_notes::get_local_note_revisions,local_notes::restore_local_note_revision,local_notes::apply_server_notes_pull,local_knowledge::get_local_knowledge_findings,local_knowledge::create_local_knowledge_finding,local_knowledge::update_local_knowledge_finding,local_knowledge::delete_local_knowledge_finding,local_knowledge::get_local_knowledge_results,local_knowledge::create_local_knowledge_result,local_knowledge::update_local_knowledge_result,local_knowledge::delete_local_knowledge_result,local_knowledge::get_local_knowledge_relationships,local_knowledge::create_local_knowledge_relationship,local_knowledge::delete_local_knowledge_relationship,local_knowledge::search_local_knowledge,local_knowledge::get_local_knowledge_overview,local_knowledge::apply_server_knowledge_pull,local_knowledge::get_local_knowledge_tags,local_locations::list_local_locations,local_locations::get_local_location,local_locations::create_local_location,local_locations::update_local_location,local_locations::delete_local_location,local_locations::apply_server_location_pull,local_resources::list_local_resources,local_resources::get_local_resource,local_resources::cache_local_resources,local_resources::create_local_resource_link,local_resources::queue_local_resource_download,local_resources::create_local_resource_folder,local_resources::update_local_resource_metadata,local_resources::delete_local_resource,local_resources::apply_server_resource_pull,local_resources::get_local_resource_tags,local_finance::get_local_transactions,local_finance::create_local_transaction,local_finance::update_local_transaction,local_finance::delete_local_transaction,local_finance::get_local_budget_periods,local_finance::create_local_budget_period,local_finance::update_local_budget_period,local_finance::delete_local_budget_period,local_finance::get_local_funding_sources,local_finance::create_local_funding_source,local_finance::update_local_funding_source,local_finance::delete_local_funding_source,local_finance::apply_server_finance_pull,local_search::global_local_search,local_system::get_local_daily_use_preferences,local_system::update_local_daily_use_preferences,local_engineering::get_local_engineering_formulas,local_engineering::calculate_local_engineering,local_engineering::get_local_engineering_calculations,local_engineering::create_local_engineering_calculation,local_engineering::delete_local_engineering_calculation,local_engineering::get_local_engineering_tests,local_engineering::create_local_engineering_test,local_engineering::update_local_engineering_test,local_engineering::delete_local_engineering_test,local_engineering::apply_server_engineering_pull]).system_tray(tauri::SystemTray::new().with_menu(tray_menu)).on_system_tray_event(|app,event|match event{tauri::SystemTrayEvent::LeftClick{..}=>{if let Some(window)=app.get_window("main"){let _=window.show();let _=window.set_focus();}},tauri::SystemTrayEvent::MenuItemClick{id,..}=>match id.as_str(){"quit"=>std::process::exit(0),"hide"=>{if let Some(window)=app.get_window("main"){let _=window.hide();}},"show"=>{if let Some(window)=app.get_window("main"){let _=window.show();let _=window.set_focus();}},_=>{}},_=>{}}).on_menu_event(|event|match event.menu_item_id(){_=>{}}).run(context).expect("error while running Tauri application");
}
