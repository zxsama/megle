use tokio::sync::mpsc;

use crate::db::Database;

pub type TaskSender = mpsc::Sender<i64>;

pub fn start_worker(worker_database: Database) -> TaskSender {
    let (sender, mut receiver) = mpsc::channel(128);
    tokio::spawn(async move {
        while let Some(task_id) = receiver.recv().await {
            run_task(&worker_database, task_id);
        }
    });
    sender
}

fn run_task(database: &Database, task_id: i64) {
    if let Err(error) = run_task_with_database(database, task_id) {
        let _ = database.mark_task_failed(task_id, &error.to_string());
    }
}

fn run_task_with_database(database: &Database, task_id: i64) -> anyhow::Result<()> {
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
            crate::scan::scan_root(database, &root)?;
            database.mark_task_succeeded(task_id)?;
            Ok(())
        }
        other => Err(anyhow::anyhow!("unsupported task kind: {other}")),
    }
}
