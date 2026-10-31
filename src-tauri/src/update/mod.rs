use serde_json::Value;

use crate::core::models::UpdateInfo;

/// 远端更新清单（JSON）。结构见 README「升级清单」：
///
/// ```json
/// {
///   "new_version": "v0.1.1",
///   "v0.1.0": { "win": "https://…/yooso_box_0.1.0_x64-setup.exe" },
///   "v0.1.1": {
///     "win": "https://…/yooso_box_0.1.1_x64-setup.exe",
///     "mac": "https://…/yooso_box_0.1.1.dmg",
///     "desc": "1. 全新版本\n2. 修复了一些问题"
///   }
/// }
/// ```
const UPDATE_URL: &str = "https://qnres.yoosobyte.com/yooso-toolbox/update.json";

/// 当前平台对应的清单键：macOS 用 `mac`，Windows（以及 Linux 兜底）用 `win`。
fn platform_key() -> &'static str {
    if cfg!(target_os = "macos") {
        "mac"
    } else {
        "win"
    }
}

fn platform_label(key: &str) -> &'static str {
    if key == "mac" {
        "macOS"
    } else {
        "Windows"
    }
}

/// 去掉版本号里可能带的 `v` / `V` 前缀和首尾空白。
fn normalize_version(value: &str) -> String {
    value.trim().trim_start_matches(['v', 'V']).to_string()
}

/// 归一化更新说明：`\n`、误写的 `/n`、CRLF 都统一成换行，去掉首尾空白。
fn normalize_notes(value: &str) -> String {
    value
        .replace("\\r\\n", "\n")
        .replace("\\n", "\n")
        .replace("/n", "\n")
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_string()
}

/// 按点分段比较版本号，返回 latest 是否比 current 新。
fn is_newer(latest: &str, current: &str) -> bool {
    let parse = |value: &str| -> Vec<u64> {
        normalize_version(value)
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

/// 解析更新清单，按平台取出新版本安装包地址。
fn parse_manifest(text: &str, current: &str, platform: &str) -> Result<UpdateInfo, String> {
    let text = text.trim_start_matches('\u{feff}');
    let root: Value =
        serde_json::from_str(text).map_err(|error| format!("更新清单不是合法 JSON：{error}"))?;
    let object = root
        .as_object()
        .ok_or_else(|| "更新清单格式错误：根节点必须是对象".to_string())?;

    let raw_latest = object
        .get("new_version")
        .and_then(Value::as_str)
        .ok_or_else(|| "更新清单缺少 new_version 字段".to_string())?;
    let latest = normalize_version(raw_latest);
    if latest.is_empty() {
        return Err("更新清单的 new_version 为空".to_string());
    }

    // 版本键可能写成 `v0.1.1`，也可能写成 `0.1.1`，两种都认
    let with_v = format!("v{latest}");
    let links = object
        .get(raw_latest)
        .or_else(|| object.get(&latest))
        .or_else(|| object.get(&with_v))
        .and_then(Value::as_object)
        .ok_or_else(|| format!("更新清单缺少 {raw_latest} 的下载地址"))?;

    let url = links
        .get(platform)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();

    // 更新说明放在版本条目里（`desc`），也兼容写在根节点
    let raw_notes = links
        .get("desc")
        .and_then(Value::as_str)
        .or_else(|| object.get("desc").and_then(Value::as_str))
        .unwrap_or_default();
    let notes = normalize_notes(raw_notes);

    let has_update = is_newer(&latest, current);
    if has_update && url.is_empty() {
        return Err(format!(
            "更新清单缺少 {raw_latest} 的 {} 安装包地址",
            platform_label(platform)
        ));
    }

    Ok(UpdateInfo {
        current: normalize_version(current),
        latest,
        url,
        has_update,
        notes,
    })
}

#[tauri::command]
pub async fn check_update() -> Result<UpdateInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|error| error.to_string())?;
    // 带时间戳绕过 CDN 缓存，避免刚发的版本要等缓存过期才能被看到
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default();
    let response = client
        .get(format!("{UPDATE_URL}?t={stamp}"))
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("HTTP 错误：{error}"))?;
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取响应失败：{error}"))?;
    parse_manifest(&text, env!("CARGO_PKG_VERSION"), platform_key())
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &str = r#"{
      "new_version": "v0.1.1",
      "v0.1.0": {
        "mac": "https://qnres.yoosobyte.com/yooso-toolbox/悦盒_0.1.0.dmg",
        "win": "https://qnres.yoosobyte.com/yooso-toolbox/悦盒_0.1.0_x64-setup.exe"
      },
      "v0.1.1": {
        "mac": "https://qnres.yoosobyte.com/yooso-toolbox/悦盒_0.1.1.dmg",
        "win": "https://qnres.yoosobyte.com/yooso-toolbox/悦盒_0.1.1_x64-setup.exe"
      }
    }"#;

    #[test]
    fn picks_windows_installer() {
        let info = parse_manifest(MANIFEST, "0.1.0", "win").unwrap();
        assert!(info.has_update);
        assert_eq!(info.latest, "0.1.1");
        assert_eq!(info.current, "0.1.0");
        assert_eq!(
            info.url,
            "https://qnres.yoosobyte.com/yooso-toolbox/悦盒_0.1.1_x64-setup.exe"
        );
    }

    #[test]
    fn picks_macos_installer() {
        let info = parse_manifest(MANIFEST, "0.1.0", "mac").unwrap();
        assert!(info.has_update);
        assert_eq!(
            info.url,
            "https://qnres.yoosobyte.com/yooso-toolbox/悦盒_0.1.1.dmg"
        );
    }

    #[test]
    fn already_latest() {
        let info = parse_manifest(MANIFEST, "0.1.1", "win").unwrap();
        assert!(!info.has_update);
        assert_eq!(info.latest, "0.1.1");
    }

    #[test]
    fn accepts_plain_version_keys() {
        let text = r#"{
          "new_version": "0.2.0",
          "0.2.0": { "win": "https://example.com/a.exe" }
        }"#;
        let info = parse_manifest(text, "0.1.9", "win").unwrap();
        assert!(info.has_update);
        assert_eq!(info.url, "https://example.com/a.exe");
    }

    #[test]
    fn current_version_with_v_prefix() {
        let info = parse_manifest(MANIFEST, "v0.1.1", "win").unwrap();
        assert!(!info.has_update);
        assert_eq!(info.current, "0.1.1");
    }

    #[test]
    fn missing_platform_url_is_error() {
        let text = r#"{
          "new_version": "v0.2.0",
          "v0.2.0": { "win": "https://example.com/a.exe" }
        }"#;
        let error = parse_manifest(text, "0.1.0", "mac").unwrap_err();
        assert!(error.contains("macOS"), "unexpected error: {error}");
    }

    #[test]
    fn missing_links_is_error() {
        let text = r#"{ "new_version": "v0.2.0" }"#;
        let error = parse_manifest(text, "0.1.0", "win").unwrap_err();
        assert!(error.contains("v0.2.0"), "unexpected error: {error}");
    }

    #[test]
    fn invalid_json_is_error() {
        assert!(parse_manifest("<html>404</html>", "0.1.0", "win").is_err());
    }

    #[test]
    fn tolerates_utf8_bom() {
        let text = format!("\u{feff}{MANIFEST}");
        assert!(parse_manifest(&text, "0.1.0", "win").is_ok());
    }

    #[test]
    fn tolerant_of_trailing_slash_newlines() {
        let text = r#"{
          "new_version": "v0.2.0",
          "v0.2.0": {
            "win": "https://example.com/a.exe",
            "desc": "1. 全新版本/n2. 修复了一些问题"
          }
        }"#;
        let info = parse_manifest(text, "0.1.0", "win").unwrap();
        assert_eq!(info.notes, "1. 全新版本\n2. 修复了一些问题");
    }

    #[test]
    fn parses_description_with_escaped_newline() {
        let text = r#"{
          "new_version": "v0.2.0",
          "v0.2.0": {
            "win": "https://example.com/a.exe",
            "desc": "1. 全新版本\n2. 修复了一些问题"
          }
        }"#;
        let info = parse_manifest(text, "0.1.0", "win").unwrap();
        assert_eq!(info.notes, "1. 全新版本\n2. 修复了一些问题");
    }

    #[test]
    fn description_is_optional() {
        let info = parse_manifest(MANIFEST, "0.1.0", "win").unwrap();
        assert!(info.notes.is_empty());
    }

    #[test]
    fn trailing_comma_is_error() {
        let text = r#"{ "new_version": "v0.2.0", "v0.2.0": { "win": "https://example.com/a.exe", }, }"#;
        let error = parse_manifest(text, "0.1.0", "win").unwrap_err();
        assert!(error.contains("JSON"), "unexpected error: {error}");
    }

    #[test]
    fn compares_versions() {
        assert!(is_newer("0.1.10", "0.1.9"));
        assert!(is_newer("v1.0.0", "0.9.9"));
        assert!(is_newer("0.2", "0.1.9"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.1.1"));
    }

    /// 联网校验线上清单（手动运行）：
    /// `cargo test --release --lib live_manifest -- --ignored --nocapture`
    #[test]
    #[ignore = "需要联网，手动运行"]
    fn live_manifest_is_parseable() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let text = runtime.block_on(async {
            reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .unwrap()
                .get(UPDATE_URL)
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .text()
                .await
                .unwrap()
        });
        for platform in ["win", "mac"] {
            let info = parse_manifest(&text, "0.1.0", platform).unwrap();
            assert!(info.has_update, "{platform} 没有检测到新版本");
            assert!(!info.url.is_empty(), "{platform} 下载地址为空");
            println!("{platform}: {} -> {}", info.latest, info.url);
        }
    }
}
