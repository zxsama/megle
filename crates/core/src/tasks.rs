use tokio::sync::mpsc;

use crate::db::{Database, TaskScanProgress};

const TASK_PROGRESS_FLUSH_INTERVAL_ITEMS: i64 = 100;

pub type TaskSender = mpsc::Sender<i64>;

pub fn start_worker(worker_database: Database) -> TaskSender {
    let mut worker_database = worker_database;
    worker_database
        .reset_running_root_scan_tasks_for_recovery()
        .expect("reset running root_scan tasks for startup recovery");
    let recovery_task_ids = worker_database
        .list_pending_root_scan_task_ids()
        .expect("list pending root_scan tasks for startup recovery");

    let (sender, mut receiver) = mpsc::channel(128);
    tokio::spawn(async move {
        for task_id in recovery_task_ids {
            run_task(&mut worker_database, task_id);
        }
        while let Some(task_id) = receiver.recv().await {
            run_task(&mut worker_database, task_id);
        }
    });
    sender
}

fn run_task(database: &mut Database, task_id: i64) {
    if let Err(error) = run_task_with_database(database, task_id) {
        let _ = database.mark_task_failed(task_id, &error.to_string());
    }
}

fn run_task_with_database(database: &mut Database, task_id: i64) -> anyhow::Result<()> {
    let task = database
        .get_task(task_id)?
        .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
    if task.status != "pending" {
        return Err(anyhow::anyhow!(
            "task {task_id} is not pending; current status is {}",
            task.status
        ));
    }
    database.mark_task_running(task_id)?;

    match task.kind.as_str() {
        "root_scan" => {
            let root_id = task
                .root_id
                .ok_or_else(|| anyhow::anyhow!("root_scan task missing root id: {task_id}"))?;
            let root = database
                .get_root(root_id)?
                .ok_or_else(|| anyhow::anyhow!("root not found: {root_id}"))?;
            let mut progress_database = database.reopen()?;
            let mut latest_progress = TaskScanProgress {
                items_seen: 0,
                items_total: None,
                folders_seen: 0,
                media_files_seen: 0,
                skipped_files: 0,
            };
            let mut last_flushed_items = -TASK_PROGRESS_FLUSH_INTERVAL_ITEMS;
            let mut progress_callback = |progress: TaskScanProgress| {
                latest_progress = progress;
                if progress.items_seen - last_flushed_items >= TASK_PROGRESS_FLUSH_INTERVAL_ITEMS {
                    if let Some(progress_database) = &mut progress_database {
                        if progress_database
                            .update_task_scan_progress(task_id, progress)
                            .is_ok()
                        {
                            last_flushed_items = progress.items_seen;
                        }
                    }
                }
            };
            let summary =
                crate::scan::scan_root_with_progress(database, &root, &mut progress_callback)?;
            drop(progress_callback);
            latest_progress = TaskScanProgress {
                items_seen: latest_progress.items_seen,
                items_total: None,
                folders_seen: summary.folders_seen as i64,
                media_files_seen: summary.media_files_seen as i64,
                skipped_files: summary.skipped_files as i64,
            };
            database.update_task_scan_progress(task_id, latest_progress)?;
            database.mark_task_succeeded(task_id)?;
            Ok(())
        }
        other => Err(anyhow::anyhow!("unsupported task kind: {other}")),
    }
}
