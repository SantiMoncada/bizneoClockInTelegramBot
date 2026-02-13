use std::env;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

#[derive(Debug, Clone)]
pub struct Config {
    pub telegram_bot_token: String,
    pub node_env: String,
    pub port: u16,
    pub webhook_url: Option<String>,
    pub data_dir: PathBuf,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        dotenvy::dotenv().ok();

        let telegram_bot_token =
            env::var("TELEGRAM_BOT_TOKEN").context("TELEGRAM_BOT_TOKEN is required")?;
        let node_env = env::var("NODE_ENV").unwrap_or_else(|_| "development".to_string());
        let port = env::var("PORT")
            .ok()
            .and_then(|raw| raw.parse::<u16>().ok())
            .unwrap_or(3000);

        let inferred_webhook_url = env::var("RAILWAY_PUBLIC_DOMAIN")
            .ok()
            .map(|domain| format!("https://{domain}"));
        let webhook_url = env::var("WEBHOOK_URL").ok().or(inferred_webhook_url);
        let data_dir = PathBuf::from(env::var("DATA_DIR").unwrap_or_else(|_| ".".to_string()));

        Ok(Self {
            telegram_bot_token,
            node_env,
            port,
            webhook_url,
            data_dir,
        })
    }

    pub fn resolve_data_path<P: AsRef<Path>>(&self, filename: P) -> PathBuf {
        self.data_dir.join(filename)
    }
}
