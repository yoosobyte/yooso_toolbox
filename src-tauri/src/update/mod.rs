use crate::core::models::UpdateInfo;

/// 远端版本描述文件：第一行最新版本号，第二行安装包直链
const UPDATE_URL: &str = "https://qnres.yoosobyte.com/yooso-toolbox/version.txt";

/// 按点分段比较版本号，返回 latest 是否比 current 新
fn is_newer(latest: &str, current: &str) -> bool {
    let parse = |value: &str| -> Vec<u64> {
        value
            .trim()
            .trim_start_matches('v')
            .split(|c: char| !c.is_ascii_digit())
            .filter(|part| !part.is_empty())
            .filter_map(|part| part.parse::<u64>().ok())
            .collect()
    };
    let a = parse(latest);
    let b = parse(current);
    let len = a.len().max(b.len());
    for index in 0..len {
        let left = a.get(index).copied().unwrap_or(0);
        let right = b.get(index).copied().unwrap_or(0);
        if left != right {
            return left > right;
        }
    }
    false
}

/// 解析版本 txt：忽略空行，第一行版本号、第二行下载地址
fn parse_update_file(text: &str, current: &str) -> UpdateInfo {
    let mut lines = text
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty());
    let latest = lines
        .next()
        .unwrap_or_default()
        .trim_start_matches('v')
        .to_string();
    let url = lines.next().unwrap_or_default().to_string();
    UpdateInfo {
        has_update: !latest.is_empty() && is_newer(&latest, current),
        latest,
        url,
        current: current.to_string(),
    }
}

#[tauri::command]
pub async fn check_update() -> Result<UpdateInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(UPDATE_URL)
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("HTTP 错误：{error}"))?;
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取响应失败：{error}"))?;
    Ok(parse_update_file(&text, env!("CARGO_PKG_VERSION")))
}
