use std::collections::HashSet;
use std::time::Duration;

use base64::Engine;
use reqwest::Url;

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
                   (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// 在页面 HTML 里找 <link rel="icon" href="...">
fn icon_candidates(html: &str, page: &Url) -> Vec<Url> {
    let lower = html.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(rel) = lower[from..].find("<link") {
        let start = from + rel;
        let Some(close) = lower[start..].find('>') else {
            break;
        };
        let end = start + close + 1;
        let tag_lower = &lower[start..end];
        let tag_orig = &html[start..end];
        let rel_is_icon = tag_lower.contains("rel=\"icon\"")
            || tag_lower.contains("rel='icon'")
            || tag_lower.contains("rel=icon")
            || tag_lower.contains("rel=\"shortcut icon\"")
            || tag_lower.contains("rel='shortcut icon'")
            || tag_lower.contains("rel=\"apple-touch-icon\"")
            || tag_lower.contains("rel='apple-touch-icon'");
        if rel_is_icon {
            if let Some(href) = attr(tag_lower, tag_orig, "href") {
                if !href.starts_with("data:") {
                    if let Ok(url) = page.join(&href) {
                        out.push(url);
                    }
                }
            }
        }
        from = end;
    }
    out
}

/// 大小写不敏感地取属性值；lower/orig 长度一致
fn attr(lower: &str, orig: &str, name: &str) -> Option<String> {
    let key = format!("{name}=");
    let pos = lower.find(&key)?;
    let offset = pos + key.len();
    let rest_orig = &orig[offset..];
    let rest_lower = &lower[offset..];
    let quote = rest_lower.chars().next()?;
    if quote == '"' || quote == '\'' {
        let value = &rest_orig[quote.len_utf8()..];
        let end = value.find(quote)?;
        Some(value[..end].to_string())
    } else {
        let end = rest_orig
            .find(|c: char| c.is_whitespace() || c == '>')
            .unwrap_or(rest_orig.len());
        let value = rest_orig[..end].trim().to_string();
        if value.is_empty() {
            None
        } else {
            Some(value)
        }
    }
}

fn guess_mime(path: &str, bytes: &[u8]) -> String {
    let path = path.to_ascii_lowercase();
    if path.ends_with(".svg") || bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") {
        return "image/svg+xml".into();
    }
    if path.ends_with(".png") || bytes.starts_with(b"\x89PNG") {
        return "image/png".into();
    }
    if path.ends_with(".ico") || bytes.starts_with(b"\x00\x00\x01\x00") {
        return "image/x-icon".into();
    }
    if path.ends_with(".gif") || bytes.starts_with(b"GIF8") {
        return "image/gif".into();
    }
    if path.ends_with(".webp") || (bytes.len() > 12 && &bytes[8..12] == b"WEBP") {
        return "image/webp".into();
    }
    "image/jpeg".into()
}

async fn download(client: &reqwest::Client, url: &Url) -> Option<String> {
    let response = client.get(url.clone()).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = response.bytes().await.ok()?;
    if bytes.len() < 32 || bytes.len() > 1024 * 1024 {
        return None;
    }
    let mime = if content_type.starts_with("image/") {
        content_type
            .split(';')
            .next()
            .unwrap_or("image/png")
            .to_string()
    } else {
        guess_mime(url.path(), &bytes)
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{mime};base64,{encoded}"))
}

/// 抓取网页的 favicon，返回 data URL（供前端直接 <img src>）
#[tauri::command]
pub async fn fetch_favicon(url: String) -> Result<Option<String>, String> {
    let page = Url::parse(&url).map_err(|error| error.to_string())?;
    if !matches!(page.scheme(), "http" | "https") {
        return Ok(None);
    }
    let client = reqwest::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(6))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| error.to_string())?;

    let mut candidates = Vec::new();
    if let Ok(response) = client.get(page.clone()).send().await {
        if response.status().is_success() {
            if let Ok(html) = response.text().await {
                candidates.extend(icon_candidates(&html, &page));
            }
        }
    }
    let origin = page.origin().ascii_serialization();
    if let Ok(fallback) = Url::parse(&format!("{origin}/favicon.ico")) {
        candidates.push(fallback);
    }

    let mut seen = HashSet::new();
    for candidate in candidates {
        if !seen.insert(candidate.as_str().to_string()) {
            continue;
        }
        if let Some(data) = download(&client, &candidate).await {
            return Ok(Some(data));
        }
    }
    Ok(None)
}
