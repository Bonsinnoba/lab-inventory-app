//! Blocking database reads must not occupy the window or async executor threads.
//! Two lanes limit concurrent opens/scans. Permits live inside the blocking job,
//! so abandoning an IPC future cannot release a lane while its work still runs.
use std::sync::{atomic::{AtomicUsize, Ordering}, Arc, OnceLock};
use std::time::Instant;
use tauri::async_runtime::Mutex;

static LANES: OnceLock<[Arc<Mutex<()>>; 2]> = OnceLock::new();
static NEXT: AtomicUsize = AtomicUsize::new(0);
static WAITING: AtomicUsize = AtomicUsize::new(0);
const MAX_OUTSTANDING: usize = 64;
struct Outstanding;
impl Drop for Outstanding {
    fn drop(&mut self) { WAITING.fetch_sub(1, Ordering::AcqRel); }
}

pub(crate) async fn run<T, F>(label: &'static str, work: F) -> Result<T, String>
where T: Send + 'static, F: FnOnce() -> Result<T, String> + Send + 'static {
    WAITING.fetch_update(Ordering::AcqRel, Ordering::Acquire, |n|
        (n < MAX_OUTSTANDING).then_some(n + 1))
        .map_err(|_| "Local reads are busy. Saved work is unchanged; retry shortly.".to_string())?;
    let outstanding = Outstanding;
    let queued = Instant::now();
    let lanes = LANES.get_or_init(|| std::array::from_fn(|_| Arc::new(Mutex::new(()))));
    let lane = lanes[NEXT.fetch_add(1, Ordering::Relaxed) % lanes.len()].clone();
    let permit = lane.lock_owned().await;
    tauri::async_runtime::spawn_blocking(move || {
        let _outstanding = outstanding;
        let _permit = permit;
        let start = Instant::now();
        let queue_ms = queued.elapsed().as_millis();
        let result = work();
        let work_ms = start.elapsed().as_millis();
        if queue_ms >= 250 || work_ms >= 250 {
            // Labels are hard-coded command names; never log payloads or errors.
            eprintln!("LabOS slow read: {label} queue_ms={queue_ms} work_ms={work_ms}");
        }
        result
    }).await.map_err(|_| "Local read worker failed. Saved work is unchanged.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    static TESTS: std::sync::Mutex<()> = std::sync::Mutex::new(());
    #[test]
    fn blocking_work_runs_off_the_calling_thread_and_preserves_results() {
        let _test = TESTS.lock().unwrap();
        let caller = std::thread::current().id();
        tauri::async_runtime::block_on(async {
            assert_eq!(run("test", move || {
                assert_ne!(caller, std::thread::current().id());
                Ok(42)
            }).await.unwrap(), 42);
            assert_eq!(run::<(), _>("test", || Err("permission denied".into())).await.unwrap_err(), "permission denied");
        });
    }
    #[test]
    fn executor_can_progress_while_a_read_waits_on_blocking_io() {
        let _test = TESTS.lock().unwrap();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let read = tauri::async_runtime::spawn(async move {
            run("test", move || {
                started_tx.send(()).unwrap();
                release_rx.recv_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
                Ok(())
            }).await
        });
        started_rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        let (heartbeat_tx, heartbeat_rx) = std::sync::mpsc::channel();
        tauri::async_runtime::spawn(async move { heartbeat_tx.send(()).unwrap(); });
        let heartbeat = heartbeat_rx.recv_timeout(std::time::Duration::from_secs(2));
        release_tx.send(()).unwrap();
        tauri::async_runtime::block_on(read).unwrap().unwrap();
        heartbeat.unwrap();
    }
    #[test]
    fn concurrent_read_burst_is_limited_to_two_workers() {
        let _test = TESTS.lock().unwrap();
        let gate = Arc::new((std::sync::Mutex::new(false), std::sync::Condvar::new()));
        let running = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let mut jobs = Vec::new();
        for _ in 0..12 {
            let (gate, running, peak, started) = (gate.clone(), running.clone(), peak.clone(), started_tx.clone());
            jobs.push(tauri::async_runtime::spawn(async move {
                run("burst_test", move || {
                    let count = running.fetch_add(1, Ordering::AcqRel) + 1;
                    peak.fetch_max(count, Ordering::AcqRel);
                    started.send(()).unwrap();
                    let (lock, wake) = &*gate;
                    let (open, timeout) = wake.wait_timeout_while(lock.lock().unwrap(), std::time::Duration::from_secs(5), |open| !*open).unwrap();
                    running.fetch_sub(1, Ordering::AcqRel);
                    if timeout.timed_out() && !*open { return Err("test release timed out".into()); }
                    Ok(())
                }).await
            }));
        }
        started_rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        started_rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        let (lock, wake) = &*gate;
        *lock.lock().unwrap() = true;
        wake.notify_all();
        for job in jobs { tauri::async_runtime::block_on(job).unwrap().unwrap(); }
        assert!(peak.load(Ordering::Acquire) <= 2);
    }
}
