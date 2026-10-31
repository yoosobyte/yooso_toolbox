use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use tauri::{AppHandle, Manager};

use crate::core::models::{DbConfig, RedisConfig, SessionConfig};
use crate::core::vault;

/// 本地持久化：sessions / redis / db / known_hosts 配置
///
/// 说明：密码/私钥口令按「保存凭据」开关决定是否落盘，落盘时为明文。
/// 这里不做假加密，凭据库接入（Windows Credential Manager）留到后续版本。
pub struct Store {
    dir: PathBuf,
    sessions_path: PathBuf,
    known_hosts_path: PathBuf,
    redis_path: PathBuf,
    db_path: PathBuf,
    secrets_path: PathBuf,
    lock: Mutex<()>,
}

impl Store {
    pub fn new(app: &AppHandle) -> Result<Self> {
        let dir = app
            .path()
            .app_config_dir()
            .context("无法获取应用配置目录")?;
        Self::from_dir(dir)
    }

    /// 直接指定配置目录（也便于集成测试）
    pub(crate) fn from_dir(dir: std::path::PathBuf) -> Result<Self> {
        fs::create_dir_all(&dir).with_context(|| format!("创建配置目录失败: {}", dir.display()))?;
        let sessions_path = dir.join("sessions.json");
        let known_hosts_path = dir.join("known_hosts.json");
        let redis_path = dir.join("redis.json");
        let db_path = dir.join("db.json");
        let secrets_path = dir.join("secrets.json");
        Ok(Self {
            dir,
            sessions_path,
            known_hosts_path,
            redis_path,
            db_path,
            secrets_path,
            lock: Mutex::new(()),
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// 读加密列表：锁定 / 损坏时返回空，避免把半截数据当成真实配置
    fn read_sealed<T: serde::de::DeserializeOwned>(path: &Path) -> Vec<T> {
        let Ok(raw) = fs::read_to_string(path) else {
            return Vec::new();
        };
        let Ok(json) = vault::decrypt_text(&raw) else {
            return Vec::new();
        };
        serde_json::from_str::<Vec<T>>(&json).unwrap_or_else(|error| {
            eprintln!("[store] {} 解析失败，已忽略: {error}", path.display());
            Vec::new()
        })
    }

    /// 写加密列表：未解锁时直接报错，绝不写空数据覆盖原文件
    fn write_sealed<T: serde::Serialize>(path: &Path, list: &[T]) -> Result<()> {
        let json = serde_json::to_string_pretty(list)?;
        let envelope = vault::encrypt_text(&json)?;
        let content = serde_json::to_string_pretty(&envelope)?;
        vault::write_atomic(path, &content)
    }

    /// 把旧版明文配置就地加密（首次设置主密码后调用）
    pub fn seal_legacy_files(&self) -> Result<()> {
        for path in [
            &self.sessions_path,
            &self.redis_path,
            &self.db_path,
            &self.secrets_path,
        ] {
            let Ok(raw) = fs::read_to_string(path) else {
                continue;
            };
            if raw.trim().starts_with('{') && raw.contains("\"n\"") && raw.contains("\"d\"") {
                continue;
            }
            let json = match vault::decrypt_text(&raw) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let envelope = vault::encrypt_text(&json)?;
            vault::write_atomic(path, &serde_json::to_string_pretty(&envelope)?)?;
        }
        Ok(())
    }

    fn read_sessions(&self) -> Vec<SessionConfig> {
        Self::read_sealed(&self.sessions_path)
    }

    fn write_sessions(&self, list: &[SessionConfig]) -> Result<()> {
        Self::write_sealed(&self.sessions_path, list)
    }

    pub fn list(&self) -> Vec<SessionConfig> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        self.read_sessions()
    }

    pub fn upsert(&self, mut config: SessionConfig) -> Result<Vec<SessionConfig>> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut list = self.read_sessions();

        if !config.save_password {
            config.password = None;
            config.passphrase = None;
        }
        if config.created_at.is_none() {
            config.created_at = Some(now_secs());
        }

        match list.iter_mut().find(|item| item.id == config.id) {
            Some(slot) => *slot = config,
            None => list.push(config),
        }
        self.write_sessions(&list)?;
        Ok(list)
    }

    pub fn delete(&self, id: &str) -> Result<Vec<SessionConfig>> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut list = self.read_sessions();
        list.retain(|item| item.id != id);
        self.write_sessions(&list)?;
        Ok(list)
    }

    pub fn touch(&self, id: &str) -> Result<()> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut list = self.read_sessions();
        if let Some(slot) = list.iter_mut().find(|item| item.id == id) {
            slot.last_used_at = Some(now_secs());
            self.write_sessions(&list)?;
        }
        Ok(())
    }

    /* ------------------------------- Redis -------------------------------- */

    fn read_redis(&self) -> Vec<RedisConfig> {
        Self::read_sealed(&self.redis_path)
    }

    fn write_redis(&self, list: &[RedisConfig]) -> Result<()> {
        Self::write_sealed(&self.redis_path, list)
    }

    pub fn redis_list(&self) -> Vec<RedisConfig> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        self.read_redis()
    }

    pub fn redis_upsert(&self, mut config: RedisConfig) -> Result<Vec<RedisConfig>> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut list = self.read_redis();

        if !config.save_password {
            config.password = None;
        }
        if config.created_at.is_none() {
            config.created_at = Some(now_secs());
        }

        match list.iter_mut().find(|item| item.id == config.id) {
            Some(slot) => *slot = config,
            None => list.push(config),
        }
        self.write_redis(&list)?;
        Ok(list)
    }

    pub fn redis_delete(&self, id: &str) -> Result<Vec<RedisConfig>> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut list = self.read_redis();
        list.retain(|item| item.id != id);
        self.write_redis(&list)?;
        Ok(list)
    }

    pub fn redis_touch(&self, id: &str) -> Result<()> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut list = self.read_redis();
        if let Some(slot) = list.iter_mut().find(|item| item.id == id) {
            slot.last_used_at = Some(now_secs());
            self.write_redis(&list)?;
        }
        Ok(())
    }

    /* -------------------------------- MySQL ------------------------------- */

    fn read_db(&self) -> Vec<DbConfig> {
        Self::read_sealed(&self.db_path)
    }

    fn write_db(&self, list: &[DbConfig]) -> Result<()> {
        Self::write_sealed(&self.db_path, list)
    }

    pub fn db_list(&self) -> Vec<DbConfig> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        self.read_db()
    }

    pub fn db_upsert(&self, mut config: DbConfig) -> Result<Vec<DbConfig>> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut list = self.read_db();

        if !config.save_password {
            config.password = None;
        }
        if config.created_at.is_none() {
            config.created_at = Some(now_secs());
        }
        if config.kind.trim().is_empty() {
            config.kind = "mysql".to_string();
        }

        match list.iter_mut().find(|item| item.id == config.id) {
            Some(slot) => *slot = config,
            None => list.push(config),
        }
        self.write_db(&list)?;
        Ok(list)
    }

    pub fn db_delete(&self, id: &str) -> Result<Vec<DbConfig>> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut list = self.read_db();
        list.retain(|item| item.id != id);
        self.write_db(&list)?;
        Ok(list)
    }

    pub fn db_touch(&self, id: &str) -> Result<()> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut list = self.read_db();
        if let Some(slot) = list.iter_mut().find(|item| item.id == id) {
            slot.last_used_at = Some(now_secs());
            self.write_db(&list)?;
        }
        Ok(())
    }

    /* ------------------------------ 备份 / 恢复 ------------------------------ */

    pub fn replace_sessions(&self, list: Vec<SessionConfig>) -> Result<()> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        self.write_sessions(&list)
    }

    pub fn replace_redis(&self, list: Vec<RedisConfig>) -> Result<()> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        self.write_redis(&list)
    }

    pub fn replace_db(&self, list: Vec<DbConfig>) -> Result<()> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        self.write_db(&list)
    }

    pub fn secrets_snapshot(&self, keys: &[String]) -> HashMap<String, String> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let all = self.read_secrets();
        keys.iter()
            .filter_map(|key| all.get(key).map(|value| (key.clone(), value.clone())))
            .collect()
    }

    /// 只覆盖导出包里出现的键，其余保持不变
    pub fn secrets_merge(&self, patch: HashMap<String, String>) -> Result<()> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut all = self.read_secrets();
        for (key, value) in patch {
            all.insert(key, value);
        }
        self.write_secrets(&all)
    }

    /* ------------------------------ 加密键值 ------------------------------ */

    fn read_secrets(&self) -> HashMap<String, String> {
        let Ok(raw) = fs::read_to_string(&self.secrets_path) else {
            return HashMap::new();
        };
        let Ok(json) = vault::decrypt_text(&raw) else {
            return HashMap::new();
        };
        serde_json::from_str(&json).unwrap_or_default()
    }

    fn write_secrets(&self, map: &HashMap<String, String>) -> Result<()> {
        let json = serde_json::to_string_pretty(map)?;
        let envelope = vault::encrypt_text(&json)?;
        vault::write_atomic(&self.secrets_path, &serde_json::to_string_pretty(&envelope)?)
    }

    pub fn secret_get(&self, key: &str) -> Option<String> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        self.read_secrets().get(key).cloned()
    }

    pub fn secret_set(&self, key: &str, value: &str) -> Result<()> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut map = self.read_secrets();
        map.insert(key.to_string(), value.to_string());
        self.write_secrets(&map)
    }

    pub fn secret_delete(&self, key: &str) -> Result<()> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut map = self.read_secrets();
        map.remove(key);
        self.write_secrets(&map)
    }

    /* ----------------------------- known_hosts ----------------------------- */

    fn read_known_hosts(&self) -> HashMap<String, String> {
        let Ok(raw) = fs::read_to_string(&self.known_hosts_path) else {
            return HashMap::new();
        };
        serde_json::from_str(&raw).unwrap_or_default()
    }

    pub fn known_host(&self, key: &str) -> Option<String> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        self.read_known_hosts().get(key).cloned()
    }

    pub fn remember_host(&self, key: &str, fingerprint: &str) {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut map = self.read_known_hosts();
        map.insert(key.to_string(), fingerprint.to_string());
        if let Ok(json) = serde_json::to_string_pretty(&map) {
            let _ = fs::write(&self.known_hosts_path, json);
        }
    }
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/* --------------------------- 加密键值 Tauri 命令 --------------------------- */

#[tauri::command]
pub fn secret_get(state: tauri::State<'_, crate::AppState>, key: String) -> Option<String> {
    state.store.secret_get(&key)
}

#[tauri::command]
pub fn secret_set(
    state: tauri::State<'_, crate::AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    state
        .store
        .secret_set(&key, &value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn secret_delete(state: tauri::State<'_, crate::AppState>, key: String) -> Result<(), String> {
    state
        .store
        .secret_delete(&key)
        .map_err(|error| error.to_string())
}
