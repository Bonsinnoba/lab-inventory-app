//! Opt-in, local numeric diagnostics. Never records application content or sends telemetry.
use serde::{Deserialize,Serialize};
use std::{fs::{File,OpenOptions},io::Write,sync::Mutex,time::Instant};
use tauri::AppHandle;

#[derive(Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Sample {
    elapsed_ms:f64,input_count:u32,observed_interactions:u32,event_p95_ms:f64,
    event_max_ms:f64,long_tasks:u32,long_task_max_ms:f64,heartbeat_max_ms:f64,
    event_supported:bool,long_task_supported:bool,
}
struct Writer { file:File,bytes:usize,last:Instant }
static WRITER:Mutex<Option<Writer>>=Mutex::new(None);

#[tauri::command]
pub async fn local_performance_probe(app:AppHandle,sample:Option<Sample>)->Result<bool,String>{
    if std::env::var("LABOS_PERFORMANCE_PROBE").as_deref()!=Ok("1"){return Ok(false)}
    let Some(sample)=sample else{return Ok(true)};
    let values=[sample.elapsed_ms,sample.event_p95_ms,sample.event_max_ms,sample.long_task_max_ms,sample.heartbeat_max_ms];
    if values.iter().any(|v|!v.is_finite()||*v<0.0||*v>86_400_000.0){return Err("Invalid performance sample".into())}
    tauri::async_runtime::spawn_blocking(move||->Result<bool,String>{
        let mut state=WRITER.lock().map_err(|_|"Performance diagnostics stopped")?;
        if state.is_none(){
            let directory=app.path_resolver().app_data_dir().ok_or("Missing diagnostic directory")?;
            std::fs::create_dir_all(&directory).map_err(|_|"Diagnostic directory unavailable")?;
            let file=OpenOptions::new().write(true).create_new(true).open(directory.join(format!("performance-probe-{}.jsonl",uuid::Uuid::new_v4()))).map_err(|_|"Diagnostic file unavailable")?;
            *state=Some(Writer{file,bytes:0,last:Instant::now()-std::time::Duration::from_secs(1)});
        }
        let writer=state.as_mut().unwrap();
        if writer.last.elapsed()<std::time::Duration::from_millis(500){return Ok(true)}
        let mut bytes=serde_json::to_vec(&sample).map_err(|_|"Invalid diagnostic sample")?;bytes.push(b'\n');
        if writer.bytes+bytes.len()>2*1024*1024{return Ok(false)}
        writer.file.write_all(&bytes).map_err(|_|"Diagnostic write unavailable")?;
        writer.bytes+=bytes.len();writer.last=Instant::now();Ok(true)
    }).await.map_err(|_|"Diagnostic worker unavailable".to_string())?
}
