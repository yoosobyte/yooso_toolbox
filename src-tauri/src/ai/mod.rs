use std::path::{Path, PathBuf};

use serde_json::{json, Value};

const MAX_FILE_BYTES: u64 = 512 * 1024;
const MAX_DIR_ENTRIES: usize = 500;

fn resolve_inside(root: &str, relative: &str) -> Result<PathBuf, String> {
    let root_path = std::fs::canonicalize(root).map_err(|error| format!("无效的工作目录: {error}"))?;
    let candidate = Path::new(relative);
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root_path.join(candidate)
    };
    // 允许对不存在的文件写入：尽量规范化父目录再校验
    let normalized = if joined.exists() {
        std::fs::canonicalize(&joined).map_err(|error| error.to_string())?
    } else {
        let parent = joined.parent().unwrap_or(&root_path);
        let parent = std::fs::canonicalize(parent).map_err(|error| error.to_string())?;
        parent.join(joined.file_name().ok_or("无效的文件名")?)
    };
    if !normalized.starts_with(&root_path) {
        return Err("路径越界：只能访问工作目录内的文件".into());
    }
    Ok(normalized)
}

/// 调用 DeepSeek Chat Completions（非流式）
#[tauri::command]
pub async fn ai_chat(
    api_key: String,
    model: String,
    messages: Vec<Value>,
    tools: Option<Value>,
) -> Result<Value, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("请先在设置里填写 DeepSeek API Key".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?;
    let mut body = json!({
        "model": if model.trim().is_empty() { "deepseek-chat" } else { model.trim() },
        "messages": messages,
        "stream": false,
    });
    if let Some(tools) = tools {
        if tools.as_array().map(|items| !items.is_empty()).unwrap_or(false) {
            body["tools"] = tools;
            body["tool_choice"] = json!("auto");
        }
    }
    let payload = serde_json::to_string(&body).map_err(|error| error.to_string())?;
    let response = client
        .post("https://api.deepseek.com/chat/completions")
        .bearer_auth(key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(payload)
        .send()
        .await
        .map_err(|error| format!("请求失败: {error}"))?;
    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("DeepSeek API {status}: {text}"));
    }
    serde_json::from_str::<Value>(&text).map_err(|error| format!("解析响应失败: {error}"))
}

#[tauri::command]
pub async fn ai_list_dir(root: String, path: String) -> Result<Value, String> {
    let dir = resolve_inside(&root, if path.trim().is_empty() { "." } else { &path })?;
    let mut entries = Vec::new();
    let reader = std::fs::read_dir(&dir).map_err(|error| format!("读取目录失败: {error}"))?;
    for entry in reader.flatten() {
        if entries.len() >= MAX_DIR_ENTRIES {
            break;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "node_modules" || name == ".git" || name == "target" {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        entries.push(json!({ "name": name, "isDir": is_dir }));
    }
    entries.sort_by(|a, b| {
        let a_dir = a["isDir"].as_bool().unwrap_or(false);
        let b_dir = b["isDir"].as_bool().unwrap_or(false);
        b_dir.cmp(&a_dir).then_with(|| a["name"].as_str().cmp(&b["name"].as_str()))
    });
    Ok(json!({ "path": dir.to_string_lossy(), "entries": entries }))
}

#[tauri::command]
pub async fn ai_read_file(root: String, path: String) -> Result<String, String> {
    let file = resolve_inside(&root, &path)?;
    let meta = std::fs::metadata(&file).map_err(|error| format!("读取文件失败: {error}"))?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!(
            "文件过大（{} 字节，上限 {} 字节）",
            meta.len(),
            MAX_FILE_BYTES
        ));
    }
    std::fs::read_to_string(&file).map_err(|error| format!("读取文件失败: {error}"))
}

#[tauri::command]
pub async fn ai_write_file(root: String, path: String, content: String) -> Result<(), String> {
    let file = resolve_inside(&root, &path)?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("创建目录失败: {error}"))?;
    }
    std::fs::write(&file, content).map_err(|error| format!("写入文件失败: {error}"))
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum StreamEvent {
    Content { text: String },
    Done { message: Value },
}

/// 流式调用 DeepSeek，通过 Channel 把增量内容推给前端
#[tauri::command]
pub async fn ai_chat_stream(
    api_key: String,
    model: String,
    messages: Vec<Value>,
    tools: Option<Value>,
    on_event: tauri::ipc::Channel<StreamEvent>,
) -> Result<(), String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("请先在设置里填写 DeepSeek API Key".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|error| error.to_string())?;
    let mut body = json!({
        "model": if model.trim().is_empty() { "deepseek-chat" } else { model.trim() },
        "messages": messages,
        "stream": true,
    });
    if let Some(tools) = tools {
        if tools.as_array().map(|items| !items.is_empty()).unwrap_or(false) {
            body["tools"] = tools;
            body["tool_choice"] = json!("auto");
        }
    }
    let payload = serde_json::to_string(&body).map_err(|error| error.to_string())?;
    let mut response = client
        .post("https://api.deepseek.com/chat/completions")
        .bearer_auth(key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::ACCEPT, "text/event-stream")
        .body(payload)
        .send()
        .await
        .map_err(|error| format!("请求失败: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("DeepSeek API {status}: {text}"));
    }

    let mut content = String::new();
    let mut buffer = String::new();
    let mut calls: Vec<(String, String, String)> = Vec::new();

    loop {
        let chunk = response
            .chunk()
            .await
            .map_err(|error| format!("读取响应失败: {error}"))?;
        let Some(chunk) = chunk else { break };
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim_end_matches('\r').to_string();
            buffer = buffer[pos + 1..].to_string();
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            let Some(delta) = value["choices"].get(0).and_then(|c| c.get("delta")) else {
                continue;
            };
            if let Some(text) = delta["content"].as_str() {
                if !text.is_empty() {
                    content.push_str(text);
                    let _ = on_event.send(StreamEvent::Content { text: text.to_string() });
                }
            }
            if let Some(tool_calls) = delta["tool_calls"].as_array() {
                for call in tool_calls {
                    let index = call["index"].as_u64().unwrap_or(0) as usize;
                    while calls.len() <= index {
                        calls.push((String::new(), String::new(), String::new()));
                    }
                    let slot = &mut calls[index];
                    if let Some(id) = call["id"].as_str() {
                        if !id.is_empty() {
                            slot.0 = id.to_string();
                        }
                    }
                    if let Some(name) = call["function"]["name"].as_str() {
                        slot.1.push_str(name);
                    }
                    if let Some(args) = call["function"]["arguments"].as_str() {
                        slot.2.push_str(args);
                    }
                }
            }
        }
    }

    let tool_calls: Vec<Value> = calls
        .into_iter()
        .filter(|(_, name, _)| !name.is_empty())
        .map(|(id, name, arguments)| {
            json!({
                "id": if id.is_empty() { format!("call_{name}") } else { id },
                "type": "function",
                "function": { "name": name, "arguments": arguments }
            })
        })
        .collect();
    let mut message = json!({ "role": "assistant", "content": content });
    if !tool_calls.is_empty() {
        message["tool_calls"] = Value::Array(tool_calls);
    }
    on_event
        .send(StreamEvent::Done { message })
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn ai_delete_file(root: String, path: String) -> Result<(), String> {
    let file = resolve_inside(&root, &path)?;
    std::fs::remove_file(&file).map_err(|error| format!("删除文件失败: {error}"))
}
