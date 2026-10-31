//! 配置导出 / 导入：把连接配置、加密键值与界面设置打包成一个 JSON 文件。
//!
//! 注意：导出文件是**明文**（方便跨机器迁移与人工检查），里面包含密码，需妥善保管。

use std::collections::HashMap;
use std::fs;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

use crate::core::models::{DbConfig, RedisConfig, SessionConfig};

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportOptions {
    pub sessions: bool,
    pub redis: bool,
    pub db: bool,
    pub secrets: Vec<String>,
    pub ui: bool,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportBundle {
    pub v: u32,
    pub exported_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sessions: Option<Vec<SessionConfig>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redis: Option<Vec<RedisConfig>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub db: Option<Vec<DbConfig>>,
    pub secrets: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub ui: Option<String>,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn config_export(
    state: tauri::State<'_, crate::AppState>,
    path: String,
    options: ExportOptions,
    ui: Option<String>,
) -> Result<(), String> {
    let store = &state.store;
    let mut bundle = ExportBundle {
        v: 1,
        exported_at: now_secs(),
        sessions: options.sessions.then(|| store.list()),
        redis: options.redis.then(|| store.redis_list()),
        db: options.db.then(|| store.db_list()),
        secrets: store.secrets_snapshot(&options.secrets),
        ui: if options.ui { ui } else { None },
    };
    // 避免导出空数组造成误解
    if bundle.sessions.as_ref().is_some_and(|list| list.is_empty()) {
        bundle.sessions = None;
    }
    if bundle.redis.as_ref().is_some_and(|list| list.is_empty()) {
        bundle.redis = None;
    }
    if bundle.db.as_ref().is_some_and(|list| list.is_empty()) {
        bundle.db = None;
    }
    let json = serde_json::to_string_pretty(&bundle).map_err(|error| error.to_string())?;
    fs::write(&path, json).map_err(|error| format!("写入失败: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn config_import(
    state: tauri::State<'_, crate::AppState>,
    path: String,
) -> Result<ImportResult, String> {
    let raw = fs::read_to_string(&path).map_err(|error| format!("读取失败: {error}"))?;
    let bundle: ExportBundle =
        serde_json::from_str(&raw).map_err(|_| "不是有效的悦盒备份文件".to_string())?;
    if bundle.v == 0 {
        return Err(anyhow!("备份文件版本不受支持").to_string());
    }
    let store = &state.store;
    if let Some(list) = bundle.sessions {
        store
            .replace_sessions(list)
            .map_err(|error| error.to_string())?;
    }
    if let Some(list) = bundle.redis {
        store.replace_redis(list).map_err(|error| error.to_string())?;
    }
    if let Some(list) = bundle.db {
        store.replace_db(list).map_err(|error| error.to_string())?;
    }
    if !bundle.secrets.is_empty() {
        store
            .secrets_merge(bundle.secrets)
            .map_err(|error| error.to_string())?;
    }
    Ok(ImportResult { ui: bundle.ui })
}
