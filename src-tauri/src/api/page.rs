use std::time::Duration;

use reqwest::Url;

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
                   (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(pos) = rest.find('&') {
        out.push_str(&rest[..pos]);
        let after = &rest[pos..];
        let Some(semi) = after.find(';') else {
            out.push_str(after);
            return out;
        };
        let entity = &after[1..semi];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "nbsp" => Some(' '),
            _ => None,
        }
        .or_else(|| {
            let code = if let Some(hex) = entity.strip_prefix("#x").or_else(|| entity.strip_prefix("#X")) {
                u32::from_str_radix(hex, 16).ok()
            } else if let Some(dec) = entity.strip_prefix('#') {
                dec.parse::<u32>().ok()
            } else {
                None
            }?;
            char::from_u32(code)
        });
        match decoded {
            Some(ch) => out.push(ch),
            None => out.push_str(&after[..=semi]),
        }
        rest = &after[semi + 1..];
    }
    out.push_str(rest);
    out
}

fn extract_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let open_end = start + lower[start..].find('>')? + 1;
    let close = open_end + lower[open_end..].find("</title>")?;
    let raw = html[open_end..close].trim();
    if raw.is_empty() {
        return None;
    }
    let text = decode_entities(raw)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// 抓取网页的 <title>，用于浏览器 tab 标题
pub async fn fetch_page_title(url: String) -> Result<Option<String>, String> {
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
    let response = client.get(page).send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let html = response.text().await.map_err(|error| error.to_string())?;
    Ok(extract_title(&html))
}
