use std::time::Duration;

use serde_json::{json, Value};

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
                   (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const PUBLIC_IP_ENDPOINTS: [&str; 3] = [
    "https://api.ipify.org?format=json",
    "https://ifconfig.me/all.json",
    "https://ipinfo.io/json",
];

fn local_addresses() -> Vec<Value> {
    let mut result = Vec::new();
    let Ok(interfaces) = if_addrs::get_if_addrs() else {
        return result;
    };
    for interface in interfaces {
        if interface.is_loopback() {
            continue;
        }
        let ip = interface.ip();
        if ip.is_ipv4() {
            result.push(json!({
                "name": interface.name,
                "ip": ip.to_string(),
            }));
        }
    }
    result.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    result
}

async fn public_ip(client: &reqwest::Client) -> Option<(String, String)> {
    for endpoint in PUBLIC_IP_ENDPOINTS {
        let Ok(response) = client.get(endpoint).send().await else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }
        let Ok(text) = response.text().await else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let ip = value["ip"]
            .as_str()
            .or_else(|| value["ip_addr"].as_str())
            .or_else(|| value["query"].as_str());
        if let Some(ip) = ip {
            let place = [
                value["city"].as_str(),
                value["region"].as_str(),
                value["country"].as_str(),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" · ");
            return Some((ip.to_string(), place));
        }
    }
    None
}

/// 获取本机公网 IP + 内网 IP（跨平台）
#[tauri::command]
pub async fn network_info() -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| error.to_string())?;
    let public = public_ip(&client).await;
    Ok(json!({
        "localIps": local_addresses(),
        "publicIp": public.as_ref().map(|(ip, _)| ip.clone()),
        "location": public.map(|(_, place)| place).filter(|place| !place.is_empty()),
    }))
}
