use serde::Serialize;
#[derive(Clone, Serialize)]
pub(crate) struct StartupStatus {
    pub ready: bool,
    pub message: Option<String>,
}
impl StartupStatus {
    pub fn from_initialization(result: Result<(), String>) -> Self {
        match result{Ok(())=>Self{ready:true,message:None},Err(_)=>Self{ready:false,message:Some("This workspace could not be opened. Existing files and pending changes have not been cleared. Recovery remains available.".into())}}
    }
}
#[tauri::command]
pub fn local_startup_status(state: tauri::State<'_, StartupStatus>) -> StartupStatus {
    state.inner().clone()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_failure_is_recoverable_without_disclosing_raw_database_errors() {
        let failed =
            StartupStatus::from_initialization(Err("secret path or database content".into()));
        assert!(!failed.ready);
        assert!(!failed.message.unwrap().contains("secret"));
        assert!(StartupStatus::from_initialization(Ok(())).ready);
    }
}
