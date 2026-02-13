use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoData {
    pub lat: f64,
    pub long: f64,
    pub accuracy: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cookies {
    pub geo: String,
    pub hcmex: String,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    pub domain: String,
    pub expires: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserData {
    #[serde(rename = "userId")]
    pub user_id: i64,
    pub geo: GeoData,
    #[serde(rename = "timeZone")]
    pub time_zone: Option<String>,
    pub cookies: Cookies,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    En,
    Es,
}

impl Lang {
    pub fn code(self) -> &'static str {
        match self {
            Lang::En => "en",
            Lang::Es => "es",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Pending,
    Executed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTask {
    pub id: String,
    #[serde(rename = "userId")]
    pub user_id: i64,
    pub lang: Lang,
    pub locale: String,
    #[serde(rename = "timeZone")]
    pub time_zone: String,
    #[serde(rename = "scheduledTime")]
    pub scheduled_time: DateTime<Utc>,
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
    #[serde(rename = "executedAt")]
    pub executed_at: Option<DateTime<Utc>>,
    pub status: TaskStatus,
    pub error: Option<String>,
}
