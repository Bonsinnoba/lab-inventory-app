//! Cooperatively schedule expensive availability scans without relaxing their
//! SQLite snapshot or per-file checks. At most two full scans retain state;
//! each worker turn examines at most 16 records or roughly 75 ms of work.
use std::{future::Future, iter::Peekable, sync::{Arc, OnceLock, atomic::{AtomicUsize, Ordering}}, time::{Duration, Instant}};
use tauri::async_runtime::Mutex;

const ITEMS_PER_TURN: usize = 16;
const TURN_BUDGET: Duration = Duration::from_millis(75);
const MAX_OUTSTANDING: usize = 64;
static LANES: OnceLock<[Arc<Mutex<()>>; 2]> = OnceLock::new();
static NEXT: AtomicUsize = AtomicUsize::new(0);
static OUTSTANDING: AtomicUsize = AtomicUsize::new(0);
struct Outstanding;
impl Drop for Outstanding { fn drop(&mut self) { OUTSTANDING.fetch_sub(1, Ordering::AcqRel); } }

pub(crate) async fn run<T, F, Fut>(label: &'static str, work: F) -> Result<T, String>
where T: Send, F: FnOnce() -> Fut + Send, Fut: Future<Output=Result<T,String>> + Send {
    OUTSTANDING.fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| (n < MAX_OUTSTANDING).then_some(n + 1))
        .map_err(|_| "Local file scans are busy. Saved work is unchanged; retry shortly.".to_string())?;
    let _outstanding = Outstanding;
    let started = Instant::now();
    let lanes = LANES.get_or_init(|| std::array::from_fn(|_| Arc::new(Mutex::new(()))));
    let _permit = lanes[NEXT.fetch_add(1, Ordering::Relaxed) % lanes.len()].clone().lock_owned().await;
    let result = work().await;
    if started.elapsed() >= Duration::from_millis(250) {
        // Preserve total-duration evidence even when individual turns are short.
        eprintln!("LabOS resource scan: {label} total_ms={}", started.elapsed().as_millis());
    }
    result
}

pub(crate) fn batch<I: Iterator>(items: &mut Peekable<I>, visit: impl FnMut(I::Item)->Result<(),String>) -> Result<bool,String> {
    batch_with_limits(items, ITEMS_PER_TURN, TURN_BUDGET, visit)
}
fn batch_with_limits<I: Iterator>(items: &mut Peekable<I>, limit: usize, budget: Duration, mut visit: impl FnMut(I::Item)->Result<(),String>) -> Result<bool,String> {
    let started = Instant::now();
    for _ in 0..limit {
        let Some(item) = items.next() else { return Ok(true) };
        visit(item)?;
        if started.elapsed() >= budget { break; }
    }
    Ok(items.peek().is_none())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_scan_visits_every_record_once_in_bounded_turns() {
        let mut rows=(0..2000).peekable();let mut visited=Vec::new();let mut turns=0;
        loop { let before=visited.len();let done=batch_with_limits(&mut rows,16,Duration::MAX,|row|{visited.push(row);Ok(())}).unwrap();assert!(visited.len()-before<=16);turns+=1;if done{break} }
        assert_eq!(turns,125);assert_eq!(visited,(0..2000).collect::<Vec<_>>());
    }
    #[test]
    fn exhausted_time_budget_yields_after_one_record_and_makes_progress() {
        let mut rows=(0..3).peekable();let mut visited=Vec::new();
        assert!(!batch_with_limits(&mut rows,16,Duration::ZERO,|row|{visited.push(row);Ok(())}).unwrap());assert_eq!(visited,vec![0]);assert_eq!(rows.next(),Some(1));
    }
    #[test]
    fn failed_record_aborts_the_turn_without_visiting_later_records() {
        let mut rows=(0..4).peekable();let mut visited=Vec::new();
        let result=batch_with_limits(&mut rows,16,Duration::MAX,|row|{visited.push(row);if row==1{Err("denied".into())}else{Ok(())}});
        assert_eq!(result.unwrap_err(),"denied");assert_eq!(visited,vec![0,1]);assert_eq!(rows.next(),Some(2));
    }
    #[test]
    fn empty_scan_finishes_without_callbacks() { assert!(batch(&mut std::iter::empty::<usize>().peekable(), |_|panic!("No records")).unwrap()); }
    #[test]
    fn two_retained_scans_leave_shared_workers_available_between_turns() {
        let gate=Arc::new((std::sync::Mutex::new(false),std::sync::Condvar::new()));
        let active=Arc::new(AtomicUsize::new(0));let peak=Arc::new(AtomicUsize::new(0));
        let(started_tx,started_rx)=std::sync::mpsc::channel();let mut jobs=Vec::new();
        for _ in 0..6 {
            let(gate,active,peak,started)=(gate.clone(),active.clone(),peak.clone(),started_tx.clone());
            jobs.push(tauri::async_runtime::spawn(async move {
                run("test_scan",||async move {
                    let count=active.fetch_add(1,Ordering::AcqRel)+1;peak.fetch_max(count,Ordering::AcqRel);
                    crate::responsive_reads::run("test_scan_turn",||Ok(())).await?;
                    started.send(()).map_err(|e|e.to_string())?;
                    // Model the scheduling boundary after a worker has returned
                    // owned snapshot state and before the next turn is queued.
                    tauri::async_runtime::spawn_blocking(move||{
                        let(lock,wake)=&*gate;
                        let(open,timeout)=wake.wait_timeout_while(lock.lock().unwrap(),Duration::from_secs(5),|open|!*open).unwrap();
                        if timeout.timed_out()&&!*open{Err("Test release timed out".to_string())}else{Ok(())}
                    }).await.map_err(|e|e.to_string())??;
                    active.fetch_sub(1,Ordering::AcqRel);Ok(())
                }).await
            }));
        }
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let(fast_tx,fast_rx)=std::sync::mpsc::channel();
        let fast=tauri::async_runtime::spawn(async move {crate::responsive_reads::run("test_metadata",move||{fast_tx.send(42).unwrap();Ok(())}).await});
        let metadata=fast_rx.recv_timeout(Duration::from_secs(2));
        let(lock,wake)=&*gate;*lock.lock().unwrap()=true;wake.notify_all();
        for job in jobs{tauri::async_runtime::block_on(job).unwrap().unwrap();}
        tauri::async_runtime::block_on(fast).unwrap().unwrap();
        assert_eq!(metadata.unwrap(),42);assert_eq!(peak.load(Ordering::Acquire),2);assert_eq!(OUTSTANDING.load(Ordering::Acquire),0);
    }
}
