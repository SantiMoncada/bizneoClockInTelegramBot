use anyhow::{anyhow, Result};
use reqwest::Client;
use scraper::{Html, Selector};
use serde_json::Value;

use crate::types::{Cookies, UserData};

pub fn parse_json_cookies(json: &Value) -> Result<Cookies> {
    let arr = json
        .as_array()
        .ok_or_else(|| anyhow!("Expected cookie JSON array"))?;

    let mut geo = String::new();
    let mut hcmex = String::new();
    let mut device_id = String::new();
    let mut domain = String::new();
    let mut expires = 0_i64;

    for item in arr {
        let Some(name) = item.get("name").and_then(Value::as_str) else {
            continue;
        };

        match name {
            "geo" => {
                geo = item
                    .get("value")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
            }
            "_hcmex_key" => {
                hcmex = item
                    .get("value")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                domain = item
                    .get("domain")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let exp = item
                    .get("expirationDate")
                    .and_then(Value::as_f64)
                    .unwrap_or_default();
                expires = (exp * 1000.0) as i64;
            }
            "device_id" => {
                device_id = item
                    .get("value")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
            }
            _ => {}
        }
    }

    Ok(Cookies {
        geo,
        hcmex,
        device_id,
        domain,
        expires,
    })
}

pub async fn get_csrf_tokens(client: &Client, data: &UserData) -> Result<(Option<String>, Option<String>)> {
    let cookie_header = format!(
        "_hcmex_key={}; device_id={}; geo={}",
        data.cookies.hcmex, data.cookies.device_id, data.cookies.geo
    );

    let home_url = format!("https://{}/", data.cookies.domain);
    let home_html = client
        .get(home_url)
        .header("Cookie", &cookie_header)
        .send()
        .await?
        .text()
        .await?;

    let meta_csrf = extract_selector_attr(&home_html, "meta[name=\"csrf\"]", "content");

    let chrono_url = format!(
        "https://{}/chrono/{}/hub_chrono",
        data.cookies.domain, data.user_id
    );
    let chrono_html = client
        .get(chrono_url)
        .header("Cookie", &cookie_header)
        .send()
        .await?
        .text()
        .await?;

    let input_csrf = extract_selector_attr(&chrono_html, "input[name=\"_csrf_token\"]", "value");

    Ok((meta_csrf, input_csrf))
}

fn extract_selector_attr(html: &str, selector: &str, attr: &str) -> Option<String> {
    let doc = Html::parse_document(html);
    let sel = Selector::parse(selector).ok()?;
    doc.select(&sel)
        .next()
        .and_then(|el| el.value().attr(attr))
        .map(|s| s.to_string())
}
