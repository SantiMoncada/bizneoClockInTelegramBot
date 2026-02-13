use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::types::UserData;

#[derive(Debug)]
pub struct Database {
    file_path: PathBuf,
    users: HashMap<String, UserData>,
}

impl Database {
    pub fn new(path: impl AsRef<Path>) -> Result<Self> {
        let file_path = path.as_ref().to_path_buf();
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut db = Self {
            file_path,
            users: HashMap::new(),
        };
        db.load_from_disk();
        Ok(db)
    }

    pub fn add_user(&mut self, chat_id: i64, user: UserData) {
        self.users.insert(chat_id.to_string(), user);
        let _ = self.save_to_disk();
    }

    pub fn get_user(&self, chat_id: i64) -> Option<UserData> {
        self.users.get(&chat_id.to_string()).cloned()
    }

    pub fn remove_user(&mut self, chat_id: i64) {
        self.users.remove(&chat_id.to_string());
        let _ = self.save_to_disk();
    }

    fn load_from_disk(&mut self) {
        if !self.file_path.exists() {
            return;
        }

        match fs::read_to_string(&self.file_path) {
            Ok(content) => match serde_json::from_str::<HashMap<String, UserData>>(&content) {
                Ok(parsed) => self.users = parsed,
                Err(err) => eprintln!("error loading users json: {err}"),
            },
            Err(err) => eprintln!("error reading users file: {err}"),
        }
    }

    fn save_to_disk(&self) -> Result<()> {
        let json = serde_json::to_string_pretty(&self.users)?;
        fs::write(&self.file_path, json)?;
        Ok(())
    }
}
