use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// 前端没传超时时的默认值（秒）
const DEFAULT_TIMEOUT_SECS: u64 = 10;
/// 允许的超时范围（秒）：设置页会做同样的限制
const MIN_TIMEOUT_SECS: u64 = 1;
const MAX_TIMEOUT_SECS: u64 = 600;

fn default_timeout_secs() -> u64 {
    DEFAULT_TIMEOUT_SECS
}

/// 单次 HTTP 请求（由前端组装好完整 URL、头、体）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestSpec {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<HttpHeader>,
    #[serde(default)]
    pub body: Option<String>,
    /// none | json | text | form（json 会自动补 Content-Type）
    #[serde(default)]
    pub body_type: String,
    /// 请求超时（秒），来自设置页；缺省 10 秒
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpHeader {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponseData {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<HttpHeader>,
    /// 响应正文（文本；二进制按 lossy 处理）
    pub body: String,
    pub time_ms: u64,
    /// 正文字节数（截断前）
    pub size: u64,
    pub truncated: bool,
}

/// 响应体最多回传 2 MB，避免大文件把 IPC 和界面拖死
const MAX_BODY: usize = 2 * 1024 * 1024;

/// 把 reqwest 的错误翻译成给用户看的中文，超时单独提示
fn describe_error(error: reqwest::Error, timeout: Duration, action: &str) -> String {
    if error.is_timeout() {
        format!("请求超时（超过 {} 秒），已中断", timeout.as_secs())
    } else if error.is_connect() {
        format!("连接失败：{error}")
    } else {
        format!("{action}：{error}")
    }
}

/// 执行 HTTP 请求。放在 Rust 侧是为了绕开 WebView 的 CORS/混合内容限制，
/// 行为对齐 Postman：任意方法、任意头、跟随重定向、记录耗时。
pub async fn execute(spec: HttpRequestSpec) -> Result<HttpResponseData, String> {
    let method = reqwest::Method::from_bytes(spec.method.as_bytes())
        .map_err(|_| format!("无效的请求方法：{}", spec.method))?;

    // 超时由设置页控制；请求一直没响应时及时中断，避免界面一直转圈
    let timeout = Duration::from_secs(spec.timeout_secs.clamp(MIN_TIMEOUT_SECS, MAX_TIMEOUT_SECS));
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败：{error}"))?;

    let mut request = client.request(method, &spec.url);
    // 默认带一个 User-Agent：不少 API（GitHub 等）会直接拒绝没有 UA 的请求；
    // 用户显式传了 User-Agent 就不覆盖。
    let has_user_agent = spec
        .headers
        .iter()
        .any(|header| header.key.eq_ignore_ascii_case("user-agent"));
    if !has_user_agent {
        request = request.header(
            reqwest::header::USER_AGENT,
            concat!("YoosoToolbox/", env!("CARGO_PKG_VERSION")),
        );
    }
    for header in &spec.headers {
        if header.key.trim().is_empty() {
            continue;
        }
        request = request.header(header.key.as_str(), header.value.as_str());
    }

    match spec.body_type.as_str() {
        "json" => {
            if let Some(body) = &spec.body {
                request = request
                    .header(
                        reqwest::header::CONTENT_TYPE,
                        "application/json; charset=utf-8",
                    )
                    .body(body.clone());
            }
        }
        "form" => {
            if let Some(body) = &spec.body {
                request = request
                    .header(
                        reqwest::header::CONTENT_TYPE,
                        "application/x-www-form-urlencoded; charset=utf-8",
                    )
                    .body(body.clone());
            }
        }
        "text" => {
            if let Some(body) = &spec.body {
                request = request.body(body.clone());
            }
        }
        _ => {}
    }

    let started = Instant::now();
    let response = request
        .send()
        .await
        .map_err(|error| describe_error(error, timeout, "请求失败"))?;
    let time_ms = started.elapsed().as_millis() as u64;

    let status = response.status();
    let headers = response
        .headers()
        .iter()
        .map(|(key, value)| HttpHeader {
            key: key.as_str().to_string(),
            value: value.to_str().unwrap_or("").to_string(),
        })
        .collect::<Vec<_>>();

    let bytes = response
        .bytes()
        .await
        .map_err(|error| describe_error(error, timeout, "读取响应失败"))?;
    let size = bytes.len() as u64;
    let truncated = bytes.len() > MAX_BODY;
    let slice = if truncated {
        &bytes[..MAX_BODY]
    } else {
        &bytes[..]
    };
    let body = String::from_utf8_lossy(slice).to_string();

    Ok(HttpResponseData {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        body,
        time_ms,
        size,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(method: &str, url: &str) -> HttpRequestSpec {
        HttpRequestSpec {
            method: method.to_string(),
            url: url.to_string(),
            headers: Vec::new(),
            body: None,
            body_type: "none".to_string(),
            timeout_secs: DEFAULT_TIMEOUT_SECS,
        }
    }

    /// 外网冒烟：GET 一个必定存在的资源
    #[tokio::test]
    #[ignore = "需要外网"]
    async fn get_jsonplaceholder_post() {
        let result = execute(spec("GET", "https://jsonplaceholder.typicode.com/posts/1"))
            .await
            .expect("请求失败");
        println!(
            "status={} len={} time={}ms",
            result.status, result.size, result.time_ms
        );
        assert_eq!(result.status, 200);
        assert!(result.body.contains("\"userId\""));
    }

    /// 同一个地址用 POST：服务端返回 404，这是 jsonplaceholder 的行为，不是我们发的错
    #[tokio::test]
    #[ignore = "需要外网"]
    async fn post_same_url_returns_404() {
        let result = execute(spec("POST", "https://jsonplaceholder.typicode.com/posts/1"))
            .await
            .expect("请求失败");
        println!("POST status={}", result.status);
        assert_eq!(result.status, 404);
    }

    /// 无效域名要报错而不是 panic
    #[tokio::test]
    #[ignore = "需要外网"]
    async fn invalid_host_returns_error() {
        let result = execute(spec("GET", "https://this-host-does-not-exist.invalid/x")).await;
        assert!(result.is_err());
        println!("err={}", result.err().unwrap());
    }

    /// 目标一直不响应时要按设置的超时中断，而不是挂在那边
    #[tokio::test]
    #[ignore = "需要网络环境，且会等待约 1 秒"]
    async fn timeout_interrupts_hanging_request() {
        let mut request = spec("GET", "http://10.255.255.1/");
        request.timeout_secs = 1;
        let started = Instant::now();
        let result = execute(request).await;
        println!("err={:?}", result.as_ref().err());
        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    /// 老版本前端不带 timeoutSecs，反序列化时要回落到 10 秒
    #[test]
    fn timeout_defaults_to_ten_seconds() {
        let parsed: HttpRequestSpec = serde_json::from_str(
            r#"{"method":"GET","url":"https://example.com","bodyType":"none"}"#,
        )
        .expect("spec 反序列化失败");
        assert_eq!(parsed.timeout_secs, 10);
    }
}
