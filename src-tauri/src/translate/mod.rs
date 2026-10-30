//! 必应翻译直连：不加载网页，直接走翻译页背后的 `ttranslatev3` 接口。
//!
//! 流程与浏览器里一致：
//! 1. GET `/{translator}` 拿到一次性 `IG` / `IID` / `token` / `key`
//! 2. POST `/{ttranslatev3}`（form）→ JSON
//!
//! token 有效期约 1 小时，缓存在内存里，过期或接口 401/403 时自动刷新一次。

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use tokio::sync::Mutex;

use crate::AppState;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
    (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0";

/// 必应单次翻译的最大字符数
const MAX_CHARS: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateResult {
    pub text: String,
    /// 必应识别出来的源语言，例如 zh-Hans / en
    pub detected: Option<String>,
    pub target: String,
    /// 实际使用的线路：cn / intl
    pub line: String,
}

#[derive(Debug, Clone)]
struct Auth {
    /// 例：https://cn.bing.com
    base: String,
    ig: String,
    iid: String,
    key: i64,
    token: String,
    expires_at: Instant,
}

pub struct Translator {
    client: reqwest::Client,
    auth: Mutex<Option<Auth>>,
}

impl Translator {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::limited(10))
            .user_agent(USER_AGENT)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            client,
            auth: Mutex::new(None),
        }
    }

    /// 翻译入口。`line` 为 cn / intl；自动重试一次（刷新 token）。
    pub async fn translate(
        &self,
        text: &str,
        from: &str,
        to: &str,
        line: &str,
    ) -> Result<TranslateResult, String> {
        let text = text.trim();
        if text.is_empty() {
            return Err("翻译内容不能为空".to_string());
        }
        if text.chars().count() > MAX_CHARS {
            return Err(format!("单次最多翻译 {MAX_CHARS} 个字符"));
        }

        let from = if from == "auto" { "auto-detect" } else { from };
        match self.attempt(text, from, to, line, false).await {
            Ok(result) => Ok(result),
            Err(first) => match self.attempt(text, from, to, line, true).await {
                Ok(result) => Ok(result),
                Err(_) => Err(first),
            },
        }
    }

    async fn attempt(
        &self,
        text: &str,
        from: &str,
        to: &str,
        line: &str,
        force_refresh: bool,
    ) -> Result<TranslateResult, String> {
        let auth = self.auth(line, force_refresh).await?;
        let url = format!(
            "{}/ttranslatev3?isVertical=1&IG={}&IID={}",
            auth.base,
            encode(&auth.ig),
            encode(&auth.iid),
        );
        let body = format!(
            "fromLang={}&to={}&text={}&token={}&key={}",
            encode(from),
            encode(to),
            encode(text),
            encode(&auth.token),
            auth.key,
        );

        let response = self
            .client
            .post(&url)
            .header(
                reqwest::header::CONTENT_TYPE,
                "application/x-www-form-urlencoded",
            )
            .body(body)
            .send()
            .await
            .map_err(|error| format!("请求必应翻译失败：{error}"))?;

        let status = response.status();
        let payload = response
            .text()
            .await
            .map_err(|error| format!("读取必应翻译响应失败：{error}"))?;

        if !status.is_success() {
            let detail = error_message(&payload).unwrap_or_else(|| truncate(&payload, 120));
            return Err(format!(
                "必应翻译接口返回 HTTP {}：{detail}",
                status.as_u16()
            ));
        }

        parse_response(&payload, to, &auth.base)
    }

    async fn auth(&self, line: &str, force_refresh: bool) -> Result<Auth, String> {
        if !force_refresh {
            let cached = self.auth.lock().await;
            if let Some(auth) = cached.as_ref() {
                if auth.expires_at > Instant::now() + Duration::from_secs(30) {
                    return Ok(auth.clone());
                }
            }
        }

        let host = if line == "intl" {
            "www.bing.com"
        } else {
            "cn.bing.com"
        };
        let entry = format!("https://{host}/translator");
        let response = self
            .client
            .get(&entry)
            .send()
            .await
            .map_err(|error| format!("打开必应翻译页失败：{error}"))?
            .error_for_status()
            .map_err(|error| format!("必应翻译页不可用：{error}"))?;

        // 国际版会被 302 到地区站点（国内是 cn.bing.com），以最终地址为准
        let final_url = response.url().clone();
        let base = format!(
            "{}://{}",
            final_url.scheme(),
            final_url.host_str().unwrap_or(host)
        );
        let html = response
            .text()
            .await
            .map_err(|error| format!("读取必应翻译页失败：{error}"))?;

        let (key, token, ttl_ms) = parse_helper(&html)
            .ok_or_else(|| "必应翻译页结构变化，暂时无法获取翻译凭证".to_string())?;
        let auth = Auth {
            base,
            ig: extract_between(&html, "IG:\"", "\"")
                .ok_or_else(|| "必应翻译页缺少 IG".to_string())?
                .to_string(),
            iid: extract_between(&html, "data-iid=\"", "\"")
                .ok_or_else(|| "必应翻译页缺少 IID".to_string())?
                .to_string(),
            key,
            token,
            expires_at: Instant::now() + Duration::from_millis(ttl_ms),
        };

        *self.auth.lock().await = Some(auth.clone());
        Ok(auth)
    }
}

impl Default for Translator {
    fn default() -> Self {
        Self::new()
    }
}

fn parse_response(payload: &str, to: &str, base: &str) -> Result<TranslateResult, String> {
    let value: Value = serde_json::from_str(payload)
        .map_err(|_| format!("必应返回了非 JSON 内容：{}", truncate(payload, 120)))?;

    if let Some(message) = error_message(payload) {
        return Err(format!("必应翻译失败：{message}"));
    }

    let first = value
        .get(0)
        .ok_or_else(|| "必应翻译返回内容为空".to_string())?;
    let text = first
        .get("translations")
        .and_then(|items| items.get(0))
        .and_then(|item| item.get("text"))
        .and_then(|text| text.as_str())
        .ok_or_else(|| "必应翻译返回格式异常（缺少译文）".to_string())?;

    Ok(TranslateResult {
        text: text.to_string(),
        detected: first
            .get("detectedLanguage")
            .and_then(|lang| lang.get("language"))
            .and_then(|lang| lang.as_str())
            .map(str::to_string),
        target: to.to_string(),
        line: if base.contains("cn.bing.com") {
            "cn".to_string()
        } else {
            "intl".to_string()
        },
    })
}

fn error_message(payload: &str) -> Option<String> {
    let value: Value = serde_json::from_str(payload).ok()?;
    if let Some(message) = value.get("message").and_then(|v| v.as_str()) {
        return Some(message.to_string());
    }
    value.get("statusCode").map(|code| format!("HTTP {}", code))
}

fn extract_between<'a>(body: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let begin = body.find(start)? + start.len();
    let rest = &body[begin..];
    let finish = rest.find(end)?;
    Some(&rest[..finish])
}

/// 解析页面里的 `params_AbusePreventionHelper = [key, "token", ttl]`
fn parse_helper(body: &str) -> Option<(i64, String, u64)> {
    let start = body.find("params_AbusePreventionHelper")?;
    let rest = &body[start..];
    let open = rest.find('[')?;
    let close = rest[open..].find(']')? + open;
    let values: Vec<Value> = serde_json::from_str(&rest[open..=close]).ok()?;
    let key = values.first()?.as_i64()?;
    let token = values.get(1)?.as_str()?.to_string();
    let ttl = values.get(2).and_then(|v| v.as_u64()).unwrap_or(3_600_000);
    Some((key, token, ttl))
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    value.chars().take(max).collect::<String>() + "…"
}

/// 最小的 form-urlencoded 编码，避免为一个函数引入依赖
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_fields_are_parsed() {
        let html = r#"
            var IG:"B670B79F909D421E918ABA9A18163C95";
            <div data-iid="translator.5023">
            params_AbusePreventionHelper = [1793303361674,"rSZTTi91_1W-pvJFcvwJbF_m1ZKB6V2R",3600000];
        "#;
        assert_eq!(
            extract_between(html, "IG:\"", "\""),
            Some("B670B79F909D421E918ABA9A18163C95")
        );
        assert_eq!(
            extract_between(html, "data-iid=\"", "\""),
            Some("translator.5023")
        );
        assert_eq!(
            parse_helper(html),
            Some((
                1793303361674,
                "rSZTTi91_1W-pvJFcvwJbF_m1ZKB6V2R".to_string(),
                3_600_000
            ))
        );
    }

    #[test]
    fn form_encoding_handles_utf8_and_spaces() {
        assert_eq!(
            encode("获取 用户a+b"),
            "%E8%8E%B7%E5%8F%96+%E7%94%A8%E6%88%B7a%2Bb"
        );
    }

    #[test]
    fn response_is_parsed() {
        let payload = r#"[{"translations":[{"text":"Get user list","to":"en"}],"detectedLanguage":{"language":"zh-Hans"}}]"#;
        let result = parse_response(payload, "en", "https://cn.bing.com").expect("parse");
        assert_eq!(result.text, "Get user list");
        assert_eq!(result.detected.as_deref(), Some("zh-Hans"));
        assert_eq!(result.line, "cn");
    }

    #[tokio::test]
    #[ignore = "需要外网"]
    async fn bing_translate_roundtrip() {
        let translator = Translator::new();
        let zh_to_en = translator
            .translate("获取用户列表", "zh-Hans", "en", "cn")
            .await
            .expect("中译英");
        println!("zh->en: {:?}", zh_to_en);
        assert!(zh_to_en.text.to_lowercase().contains("user"));

        let en_to_zh = translator
            .translate("userLoginFailed", "en", "zh-Hans", "cn")
            .await
            .expect("英译中");
        println!("en->zh: {:?}", en_to_zh);
        assert!(en_to_zh.text.contains("用户"));
    }
}

#[tauri::command]
pub async fn translate_text(
    state: State<'_, AppState>,
    text: String,
    from: String,
    to: String,
    line: Option<String>,
) -> Result<TranslateResult, String> {
    state
        .translator
        .translate(&text, &from, &to, line.as_deref().unwrap_or("cn"))
        .await
}
