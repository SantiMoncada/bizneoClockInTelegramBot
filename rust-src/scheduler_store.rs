use std::fs;
use std::path::{Path, PathBuf};

use anyhow::Result;
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::types::{Lang, ScheduledTask, TaskStatus};

#[derive(Debug)]
pub struct SchedulerStore {
    file_path: PathBuf,
    schedules: Vec<ScheduledTask>,
}

impl SchedulerStore {
    pub fn new(path: impl AsRef<Path>) -> Result<Self> {
        let file_path = path.as_ref().to_path_buf();
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut store = Self {
            file_path,
            schedules: Vec::new(),
        };
        store.load_from_disk();
        Ok(store)
    }

    pub fn add(
        &mut self,
        user_id: i64,
        scheduled_time: DateTime<Utc>,
        lang: Lang,
        locale: String,
        time_zone: String,
    ) -> ScheduledTask {
        let task = ScheduledTask {
            id: Uuid::new_v4().to_string(),
            user_id,
            lang,
            locale,
            time_zone,
            scheduled_time,
            created_at: Utc::now(),
            executed_at: None,
            status: TaskStatus::Pending,
            error: None,
        };

        self.schedules.push(task.clone());
        let _ = self.save_to_disk();
        task
    }

    pub fn get_pending(&self) -> Vec<ScheduledTask> {
        let mut tasks: Vec<_> = self
            .schedules
            .iter()
            .filter(|t| t.status == TaskStatus::Pending)
            .cloned()
            .collect();
        tasks.sort_by_key(|t| t.scheduled_time);
        tasks
    }

    pub fn get_by_user(&self, user_id: i64) -> Vec<ScheduledTask> {
        let mut tasks: Vec<_> = self
            .schedules
            .iter()
            .filter(|t| t.user_id == user_id)
            .cloned()
            .collect();
        tasks.sort_by_key(|t| t.scheduled_time);
        tasks
    }

    pub fn mark_executed(&mut self, id: &str, error: Option<String>) -> bool {
        let Some(task) = self.schedules.iter_mut().find(|t| t.id == id) else {
            return false;
        };

        if let Some(err) = error {
            task.status = TaskStatus::Failed;
            task.error = Some(err);
        } else {
            task.status = TaskStatus::Executed;
            task.executed_at = Some(Utc::now());
            task.error = None;
        }

        let _ = self.save_to_disk();
        true
    }

    pub fn cancel(&mut self, id: &str) -> bool {
        let Some(task) = self.schedules.iter_mut().find(|t| t.id == id) else {
            return false;
        };

        task.status = TaskStatus::Failed;
        task.error = Some("cancelled".to_string());
        let _ = self.save_to_disk();
        true
    }

    fn load_from_disk(&mut self) {
        if !self.file_path.exists() {
            self.schedules = Vec::new();
            return;
        }

        match fs::read_to_string(&self.file_path) {
            Ok(content) => match serde_json::from_str::<Vec<ScheduledTask>>(&content) {
                Ok(parsed) => self.schedules = parsed,
                Err(err) => {
                    eprintln!("error loading schedule json: {err}");
                    self.schedules = Vec::new();
                }
            },
            Err(err) => {
                eprintln!("error reading schedule file: {err}");
                self.schedules = Vec::new();
            }
        }
    }

    fn save_to_disk(&self) -> Result<()> {
        let json = serde_json::to_string_pretty(&self.schedules)?;
        fs::write(&self.file_path, json)?;
        Ok(())
    }
}
