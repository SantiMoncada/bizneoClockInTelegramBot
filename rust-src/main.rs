mod config;
mod database;
mod helper_functions;
mod i18n;
mod phoenix_token;
mod scheduler_store;
mod types;

use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use base64::Engine;
use chrono::{Timelike, Utc};
use chrono_tz::Tz;
use reqwest::Client;
use serde_json::Value;
use teloxide::prelude::*;
use teloxide::types::{BotCommand, ChatId};
use tokio::sync::Mutex;

use crate::config::Config;
use crate::database::Database;
use crate::helper_functions::{get_csrf_tokens, parse_json_cookies};
use crate::i18n::{format_template, texts};
use crate::phoenix_token::parse_user_id;
use crate::scheduler_store::SchedulerStore;
use crate::types::{GeoData, Lang, TaskStatus, UserData};

const DEFAULT_TIME_ZONE: &str = "Europe/Madrid";

#[derive(Clone)]
struct AppState {
    db: Arc<Mutex<Database>>,
    scheduler: Arc<Mutex<SchedulerStore>>,
    http: Client,
    schedule_running: Arc<AtomicBool>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let config = Config::from_env()?;

    let db = Database::new(config.resolve_data_path("userData.json"))?;
    let scheduler = SchedulerStore::new(config.resolve_data_path("scheduledTasks.json"))?;

    let state = AppState {
        db: Arc::new(Mutex::new(db)),
        scheduler: Arc::new(Mutex::new(scheduler)),
        http: Client::builder().build()?,
        schedule_running: Arc::new(AtomicBool::new(false)),
    };

    let bot = Bot::new(config.telegram_bot_token.clone());

    set_bot_commands(&bot).await?;

    println!("Bot started in {} mode", config.node_env);
    println!("PORT={}", config.port);
    println!("WEBHOOK_URL={}", config.webhook_url.clone().unwrap_or_else(|| "not set".to_string()));
    println!("DATA_DIR={}", config.data_dir.display());

    let scheduler_bot = bot.clone();
    let scheduler_state = state.clone();
    tokio::spawn(async move {
        scheduler_loop(scheduler_bot, scheduler_state).await;
    });

    let handler = Update::filter_message().endpoint(handle_message);

    Dispatcher::builder(bot, handler)
        .dependencies(dptree::deps![state, config])
        .enable_ctrlc_handler()
        .build()
        .dispatch()
        .await;

    Ok(())
}

async fn set_bot_commands(bot: &Bot) -> Result<()> {
    let en_commands = vec![
        BotCommand::new("start", "Get setup instructions and login steps"),
        BotCommand::new("data", "Show your saved account info"),
        BotCommand::new("clocknow", "Clock in right now"),
        BotCommand::new("clockin", "Schedule a future clock-in time"),
        BotCommand::new("list", "List your scheduled clock-ins"),
        BotCommand::new("cancel", "Cancel a scheduled clock-in"),
        BotCommand::new("location", "Show your saved location link"),
        BotCommand::new("settimezone", "Set your time zone"),
    ];

    let es_commands = vec![
        BotCommand::new("start", "Ver instrucciones de inicio y acceso"),
        BotCommand::new("data", "Mostrar tu informacion guardada"),
        BotCommand::new("clocknow", "Fichar ahora mismo"),
        BotCommand::new("clockin", "Programar un fichaje"),
        BotCommand::new("list", "Ver fichajes programados"),
        BotCommand::new("cancel", "Cancelar un fichaje programado"),
        BotCommand::new("location", "Mostrar enlace de ubicacion guardada"),
        BotCommand::new("settimezone", "Configurar zona horaria"),
    ];

    bot.set_my_commands(en_commands).await?;
    bot.set_my_commands(es_commands)
        .language_code("es".to_string())
        .await?;
    Ok(())
}

async fn handle_message(bot: Bot, msg: Message, state: AppState, config: Config) -> ResponseResult<()> {
    let chat_id = msg.chat.id;
    let lang = get_lang_from_message(&msg);
    let locale = get_locale_from_message(&msg);

    if msg.document().is_some() {
        if let Err(err) = handle_document(&bot, &msg, &state, &config, lang, &locale).await {
            let text = format_template(texts(lang).doc_error, &[("error", err.to_string())]);
            bot.send_message(chat_id, text).await?;
        }
        return Ok(());
    }

    if msg.location().is_some() {
        if let Err(err) = handle_location_update(&bot, &msg, &state, lang).await {
            eprintln!("location update failed: {err}");
        }
        return Ok(());
    }

    let Some(text) = msg.text() else {
        return Ok(());
    };

    let command = first_token(text).to_ascii_lowercase();

    match command.as_str() {
        "/start" => {
            bot.send_message(chat_id, texts(lang).start).await?;
        }
        "/clocknow" => {
            if let Some(data) = require_valid_user(&bot, &state, chat_id, lang).await? {
                let tz = user_tz(&data);
                if let Err(err) = perform_clock_in(&bot, &state, chat_id, &data, lang, &locale, &tz, None).await {
                    let reply = format_template(texts(lang).clocknow_error, &[("error", err.to_string())]);
                    bot.send_message(chat_id, reply).await?;
                }
            }
        }
        "/clockin" => {
            let Some(raw) = command_arg(text) else {
                bot.send_message(chat_id, texts(lang).usage_clockin).await?;
                return Ok(());
            };

            let Some(data) = require_valid_user(&bot, &state, chat_id, lang).await? else {
                return Ok(());
            };

            let Some((hours, minutes)) = parse_clock_time(raw) else {
                bot.send_message(chat_id, texts(lang).invalid_clockin).await?;
                return Ok(());
            };

            let tz = user_tz(&data);
            let scheduled_time = match next_occurrence(hours, minutes, &tz) {
                Ok(value) => value,
                Err(err) => {
                    eprintln!("invalid schedule build for /clockin: {err}");
                    bot.send_message(chat_id, texts(lang).invalid_clockin).await?;
                    return Ok(());
                }
            };

            let task = {
                let mut scheduler = state.scheduler.lock().await;
                scheduler.add(chat_id.0, scheduled_time, lang, locale.clone(), tz.clone())
            };

            let formatted = format_schedule_time(&task.scheduled_time, &tz);
            let reply = format_template(
                texts(lang).scheduled_clockin,
                &[("time", formatted), ("id", task.id.clone())],
            );
            bot.send_message(chat_id, reply).await?;
        }
        "/list" => {
            let maybe_user = { state.db.lock().await.get_user(chat_id.0) };
            if let Some(user) = maybe_user.as_ref() {
                if is_session_expired(user) {
                    state.db.lock().await.remove_user(chat_id.0);
                    bot.send_message(chat_id, texts(lang).session_expired).await?;
                }
            }

            let fallback_tz = maybe_user
                .as_ref()
                .map(user_tz)
                .unwrap_or_else(|| DEFAULT_TIME_ZONE.to_string());

            let tasks = { state.scheduler.lock().await.get_by_user(chat_id.0) };
            if tasks.is_empty() {
                bot.send_message(chat_id, texts(lang).list_empty).await?;
                return Ok(());
            }

            let mut lines = Vec::with_capacity(tasks.len());
            for task in tasks {
                let (emoji, status_label) = match task.status {
                    TaskStatus::Pending => ("⏳", texts(lang).status_pending),
                    TaskStatus::Executed => ("✅", texts(lang).status_executed),
                    TaskStatus::Failed => ("❌", texts(lang).status_failed),
                };

                let tz = if task.time_zone.is_empty() {
                    fallback_tz.clone()
                } else {
                    task.time_zone.clone()
                };
                let time = format_schedule_time(&task.scheduled_time, &tz);
                lines.push(format!("{emoji} {} - {} ({status_label})", task.id, time));
            }

            let output = format!("{}\n\n{}", texts(lang).list_header, lines.join("\n"));
            bot.send_message(chat_id, output).await?;
        }
        "/cancel" => {
            let Some(arg) = command_arg(text).map(str::trim).filter(|s| !s.is_empty()) else {
                bot.send_message(chat_id, texts(lang).cancel_usage).await?;
                return Ok(());
            };

            let tasks = { state.scheduler.lock().await.get_by_user(chat_id.0) };

            if arg.eq_ignore_ascii_case("all") {
                let pending: Vec<_> = tasks
                    .iter()
                    .filter(|t| t.status == TaskStatus::Pending)
                    .map(|t| t.id.clone())
                    .collect();

                if pending.is_empty() {
                    bot.send_message(chat_id, texts(lang).cancel_all_none).await?;
                    return Ok(());
                }

                let mut scheduler = state.scheduler.lock().await;
                for id in &pending {
                    scheduler.cancel(id);
                }

                let reply = format_template(
                    texts(lang).cancel_all_ok,
                    &[("count", pending.len().to_string())],
                );
                bot.send_message(chat_id, reply).await?;
                return Ok(());
            }

            let owns = tasks.iter().any(|t| t.id == arg);
            if !owns {
                bot.send_message(chat_id, texts(lang).cancel_not_found).await?;
                return Ok(());
            }

            let cancelled = { state.scheduler.lock().await.cancel(arg) };
            if cancelled {
                let reply = format_template(texts(lang).cancel_ok, &[("id", arg.to_string())]);
                bot.send_message(chat_id, reply).await?;
            } else {
                bot.send_message(chat_id, texts(lang).cancel_fail).await?;
            }
        }
        "/data" => {
            let Some(data) = require_valid_user(&bot, &state, chat_id, lang).await? else {
                return Ok(());
            };

            let status_set = texts(lang).status_set;
            let status_missing = texts(lang).status_missing;
            let hcmex_status = if data.cookies.hcmex.is_empty() {
                status_missing
            } else {
                status_set
            };
            let device_status = if data.cookies.device_id.is_empty() {
                status_missing
            } else {
                status_set
            };
            let geo_status = if data.cookies.geo.is_empty() {
                status_missing
            } else {
                status_set
            };

            let expires = chrono::DateTime::<Utc>::from_timestamp_millis(data.cookies.expires)
                .map(|d| d.to_rfc3339())
                .unwrap_or_else(|| "unknown".to_string());

            let reply = vec![
                texts(lang).data_header.to_string(),
                String::new(),
                format_template(texts(lang).data_user_id, &[("userId", data.user_id.to_string())]),
                format_template(
                    texts(lang).data_location,
                    &[
                        ("lat", format!("{:.6}", data.geo.lat)),
                        ("long", format!("{:.6}", data.geo.long)),
                        ("accuracy", data.geo.accuracy.to_string()),
                    ],
                ),
                format_template(texts(lang).data_domain, &[("domain", data.cookies.domain.clone())]),
                texts(lang).data_cookies.to_string(),
                format_template(texts(lang).data_cookie_hcmex, &[("status", hcmex_status.to_string())]),
                format_template(texts(lang).data_cookie_device, &[("status", device_status.to_string())]),
                format_template(texts(lang).data_cookie_geo, &[("status", geo_status.to_string())]),
                format_template(texts(lang).data_expires, &[("expires", expires)]),
            ]
            .join("\n");

            bot.send_message(chat_id, reply).await?;
        }
        "/location" => {
            let Some(data) = require_valid_user(&bot, &state, chat_id, lang).await? else {
                return Ok(());
            };

            let link = format!(
                "https://www.google.com/search?q={:.6}%2C+{:.6}",
                data.geo.lat, data.geo.long
            );
            bot.send_message(chat_id, link).await?;
        }
        "/settimezone" | "/settimezone@bizneoclockinbot" | "/settimezone@bizneo_clockin_bot" => {
            handle_set_timezone(&bot, &state, chat_id, lang, text).await?;
        }
        _ if command.starts_with("/settimezone") => {
            handle_set_timezone(&bot, &state, chat_id, lang, text).await?;
        }
        _ => {
            if command.starts_with('/') {
                return Ok(());
            }
            println!(
                "Received message from {:?}: {}",
                msg.from.as_ref().and_then(|u| u.username.clone()),
                text
            );
        }
    }

    Ok(())
}

async fn handle_set_timezone(
    bot: &Bot,
    state: &AppState,
    chat_id: ChatId,
    lang: Lang,
    text: &str,
) -> ResponseResult<()> {
    let Some(data) = require_valid_user(bot, state, chat_id, lang).await? else {
        return Ok(());
    };

    let Some(raw_tz) = command_arg(text).map(str::trim).filter(|s| !s.is_empty()) else {
        bot.send_message(chat_id, texts(lang).set_timezone_usage).await?;
        return Ok(());
    };

    if Tz::from_str(raw_tz).is_err() {
        bot.send_message(chat_id, texts(lang).set_timezone_invalid).await?;
        return Ok(());
    }

    let mut updated = data;
    updated.time_zone = Some(raw_tz.to_string());
    state.db.lock().await.add_user(chat_id.0, updated);

    let reply = format_template(texts(lang).set_timezone_ok, &[("tz", raw_tz.to_string())]);
    bot.send_message(chat_id, reply).await?;

    Ok(())
}

async fn handle_document(
    bot: &Bot,
    msg: &Message,
    state: &AppState,
    config: &Config,
    lang: Lang,
    locale: &str,
) -> Result<()> {
    let chat_id = msg.chat.id;
    let document = msg
        .document()
        .ok_or_else(|| anyhow!("Document payload missing"))?;

    let file_name = document.file_name.clone().unwrap_or_default();
    if !file_name.ends_with(".json") {
        bot.send_message(chat_id, texts(lang).doc_invalid).await?;
        return Ok(());
    }

    if document.file.size > 5 * 1024 * 1024 {
        bot.send_message(chat_id, texts(lang).doc_too_large).await?;
        return Ok(());
    }

    let file = bot.get_file(document.file.id.clone()).await?;
    let file_url = format!(
        "https://api.telegram.org/file/bot{}/{}",
        config.telegram_bot_token, file.path
    );

    let json_data: Value = state.http.get(file_url).send().await?.json().await?;
    let cookies = parse_json_cookies(&json_data)?;

    let geo_bytes = base64::engine::general_purpose::STANDARD
        .decode(&cookies.geo)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(&cookies.geo))?;
    let geo: GeoData = serde_json::from_slice(&geo_bytes)?;

    let user_id = parse_user_id(&cookies.hcmex).ok_or_else(|| anyhow!("No user id in token"))?;

    let user_data = UserData {
        user_id,
        geo: geo.clone(),
        cookies: cookies.clone(),
        time_zone: Some(DEFAULT_TIME_ZONE.to_string()),
    };

    state.db.lock().await.add_user(chat_id.0, user_data);

    let link = format!(
        "https://www.google.com/search?q={:.6}%2C+{:.6}",
        geo.lat, geo.long
    );
    let expires = chrono::DateTime::<Utc>::from_timestamp_millis(cookies.expires)
        .map(|d| d.to_rfc3339())
        .unwrap_or_else(|| locale.to_string());

    let details = format_template(
        texts(lang).doc_details,
        &[
            ("lat", format!("{:.6}", geo.lat)),
            ("long", format!("{:.6}", geo.long)),
            ("link", link),
            ("domain", cookies.domain),
            ("expires", expires),
        ],
    );

    let reply = format_template(texts(lang).doc_parsed, &[("details", details)]);
    bot.send_message(chat_id, reply).await?;

    Ok(())
}

async fn handle_location_update(bot: &Bot, msg: &Message, state: &AppState, lang: Lang) -> Result<()> {
    let chat_id = msg.chat.id;
    let location = msg
        .location()
        .ok_or_else(|| anyhow!("Location payload missing"))?;

    let Some(data) = state.db.lock().await.get_user(chat_id.0) else {
        bot.send_message(chat_id, texts(lang).login_required).await?;
        return Ok(());
    };

    let updated_geo = GeoData {
        lat: location.latitude,
        long: location.longitude,
        accuracy: 10,
    };

    let encoded_geo = base64::engine::general_purpose::STANDARD
        .encode(serde_json::to_vec(&updated_geo)?);

    let mut updated_user = data;
    updated_user.geo = updated_geo.clone();
    updated_user.cookies.geo = encoded_geo;

    state.db.lock().await.add_user(chat_id.0, updated_user);

    let link = format!(
        "https://www.google.com/search?q={:.6}%2C+{:.6}",
        updated_geo.lat, updated_geo.long
    );
    let reply = format_template(texts(lang).location_updated, &[("link", link)]);
    bot.send_message(chat_id, reply).await?;

    Ok(())
}

async fn require_valid_user(
    bot: &Bot,
    state: &AppState,
    chat_id: ChatId,
    lang: Lang,
) -> ResponseResult<Option<UserData>> {
    let data = { state.db.lock().await.get_user(chat_id.0) };

    let Some(user) = data else {
        bot.send_message(chat_id, texts(lang).login_required).await?;
        return Ok(None);
    };

    if is_session_expired(&user) {
        state.db.lock().await.remove_user(chat_id.0);
        bot.send_message(chat_id, texts(lang).session_expired).await?;
        return Ok(None);
    }

    Ok(Some(user))
}

fn is_session_expired(data: &UserData) -> bool {
    data.cookies.expires <= Utc::now().timestamp_millis()
}

fn user_tz(data: &UserData) -> String {
    data.time_zone
        .clone()
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_TIME_ZONE.to_string())
}

async fn perform_clock_in(
    bot: &Bot,
    state: &AppState,
    chat_id: ChatId,
    data: &UserData,
    lang: Lang,
    _locale: &str,
    time_zone: &str,
    scheduled_at: Option<chrono::DateTime<Utc>>,
) -> Result<()> {
    let (meta_csrf, input_csrf) = get_csrf_tokens(&state.http, data).await?;

    let form = [
        ("_csrf_token", input_csrf.unwrap_or_default()),
        ("location_id", String::new()),
        ("user_id", data.user_id.to_string()),
        ("shift_id", String::new()),
    ];

    let url = format!("https://{}/chrono", data.cookies.domain);
    let cookie_header = format!(
        "_hcmex_key={}; device_id={}; geo={}",
        data.cookies.hcmex, data.cookies.device_id, data.cookies.geo
    );

    let response = state
        .http
        .post(url)
        .header("Cookie", cookie_header)
        .header("content-type", "application/x-www-form-urlencoded")
        .header("x-csrf-token", meta_csrf.unwrap_or_default())
        .header("hx-request", "true")
        .header("hx-target", "chronometer-wrapper")
        .header("hx-trigger", "chrono-form-hub_chrono")
        .header("accept", "*/*")
        .header("origin", format!("https://{}", data.cookies.domain))
        .header("referer", format!("https://{}/", data.cookies.domain))
        .form(&form)
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(anyhow!("HTTP {}", response.status()));
    }

    if let Some(when) = scheduled_at {
        let text = format_template(
            texts(lang).clocked_in_scheduled,
            &[("time", format_schedule_time(&when, time_zone))],
        );
        bot.send_message(chat_id, text).await?;
    } else {
        bot.send_message(chat_id, texts(lang).clocked_in_now).await?;
    }

    Ok(())
}

async fn scheduler_loop(bot: Bot, state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(300));

    loop {
        interval.tick().await;
        if let Err(err) = run_scheduled_tasks(&bot, &state).await {
            eprintln!("scheduler error: {err}");
        }
    }
}

async fn run_scheduled_tasks(bot: &Bot, state: &AppState) -> Result<()> {
    if state
        .schedule_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(());
    }

    let now = Utc::now();
    let pending = {
        state
            .scheduler
            .lock()
            .await
            .get_pending()
            .into_iter()
            .filter(|t| t.scheduled_time <= now)
            .collect::<Vec<_>>()
    };

    for task in pending {
        let maybe_user = { state.db.lock().await.get_user(task.user_id) };

        let Some(user) = maybe_user else {
            state
                .scheduler
                .lock()
                .await
                .mark_executed(&task.id, Some("User not found".to_string()));
            continue;
        };

        if is_session_expired(&user) {
            state.db.lock().await.remove_user(task.user_id);
            state
                .scheduler
                .lock()
                .await
                .mark_executed(&task.id, Some("Session expired".to_string()));
            if let Err(err) = bot
                .send_message(ChatId(task.user_id), texts(task.lang).session_expired)
                .await
            {
                eprintln!("failed to notify session expiry: {err}");
            }
            continue;
        }

        let clockin_result = perform_clock_in(
            bot,
            state,
            ChatId(task.user_id),
            &user,
            task.lang,
            &task.locale,
            &task.time_zone,
            Some(task.scheduled_time),
        )
        .await;

        match clockin_result {
            Ok(_) => {
                state.scheduler.lock().await.mark_executed(&task.id, None);
            }
            Err(err) => {
                let err_text = err.to_string();
                state
                    .scheduler
                    .lock()
                    .await
                    .mark_executed(&task.id, Some(err_text.clone()));
                let msg = format_template(texts(task.lang).scheduled_failed, &[("error", err_text)]);
                if let Err(err) = bot.send_message(ChatId(task.user_id), msg).await {
                    eprintln!("failed to notify scheduled failure: {err}");
                }
            }
        }
    }

    state.schedule_running.store(false, Ordering::SeqCst);
    Ok(())
}

fn get_lang_from_message(msg: &Message) -> Lang {
    let code = msg
        .from
        .as_ref()
        .and_then(|u| u.language_code.clone())
        .unwrap_or_else(|| "en".to_string())
        .to_ascii_lowercase();
    if code.starts_with("es") {
        Lang::Es
    } else {
        Lang::En
    }
}

fn get_locale_from_message(msg: &Message) -> String {
    msg.from
        .as_ref()
        .and_then(|u| u.language_code.clone())
        .unwrap_or_else(|| "en".to_string())
}

fn first_token(input: &str) -> &str {
    input.split_whitespace().next().unwrap_or_default()
}

fn command_arg(input: &str) -> Option<&str> {
    let idx = input.find(char::is_whitespace)?;
    Some(input[idx..].trim())
}

fn parse_clock_time(input: &str) -> Option<(u32, u32)> {
    let normalized = input.trim().to_ascii_lowercase().replace(' ', "");
    if normalized.is_empty() {
        return None;
    }

    let (raw, meridiem) = if let Some(prefix) = normalized.strip_suffix("am") {
        (prefix, Some("am"))
    } else if let Some(prefix) = normalized.strip_suffix("pm") {
        (prefix, Some("pm"))
    } else {
        (normalized.as_str(), None)
    };

    let mut parts = raw.split(':');
    let h = parts.next()?.parse::<u32>().ok()?;
    let m = parts.next().map_or(Some(0), |v| v.parse::<u32>().ok())?;
    if parts.next().is_some() || m > 59 {
        return None;
    }

    match meridiem {
        Some(_) if !(1..=12).contains(&h) => None,
        Some("am") => Some((h % 12, m)),
        Some("pm") => Some(((h % 12) + 12, m)),
        None if h <= 23 => Some((h, m)),
        _ => None,
    }
}

fn next_occurrence(hours: u32, minutes: u32, time_zone: &str) -> Result<chrono::DateTime<Utc>> {
    let tz = Tz::from_str(time_zone).unwrap_or(Tz::Europe__Madrid);
    let now = Utc::now().with_timezone(&tz);

    let mut scheduled = now
        .with_hour(hours)
        .and_then(|d| d.with_minute(minutes))
        .and_then(|d| d.with_second(0))
        .and_then(|d| d.with_nanosecond(0))
        .ok_or_else(|| anyhow!("invalid schedule time"))?;

    if scheduled <= now {
        scheduled = scheduled
            .checked_add_days(chrono::Days::new(1))
            .ok_or_else(|| anyhow!("invalid schedule rollover"))?;
    }

    Ok(scheduled.with_timezone(&Utc))
}

fn format_schedule_time(utc_time: &chrono::DateTime<Utc>, time_zone: &str) -> String {
    let tz = Tz::from_str(time_zone).unwrap_or(Tz::Europe__Madrid);
    utc_time
        .with_timezone(&tz)
        .format("%a, %Y-%m-%d %H:%M %Z")
        .to_string()
}
