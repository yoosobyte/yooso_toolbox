use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use tauri::{AppHandle, Manager};

use crate::core::models::{DbConfig, RedisConfig, SessionConfig};

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
        Ok(Self {
            dir,
            sessions_path,
            known_hosts_path,
            redis_path,
            db_path,
            lock: Mutex::new(()),
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn read_sessions(&self) -> Vec<SessionConfig> {
        let Ok(raw) = fs::read_to_string(&self.sessions_path) else {
            return Vec::new();
        };
        serde_json::from_str::<Vec<SessionConfig>>(&raw).unwrap_or_else(|error| {
            eprintln!("[store] sessions.json 解析失败，已忽略: {error}");
            Vec::new()
        })
    }

    fn write_sessions(&self, list: &[SessionConfig]) -> Result<()> {
        let json = serde_json::to_string_pretty(list)?;
        let temp = self.sessions_path.with_extension("json.tmp");
        fs::write(&temp, json)?;
        fs::rename(&temp, &self.sessions_path)?;
        Ok(())
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
        let Ok(raw) = fs::read_to_string(&self.redis_path) else {
            return Vec::new();
        };
        serde_json::from_str::<Vec<RedisConfig>>(&raw).unwrap_or_else(|error| {
            eprintln!("[store] redis.json 解析失败，已忽略: {error}");
            Vec::new()
        })
    }

    fn write_redis(&self, list: &[RedisConfig]) -> Result<()> {
        let json = serde_json::to_string_pretty(list)?;
        let temp = self.redis_path.with_extension("json.tmp");
        fs::write(&temp, json)?;
        fs::rename(&temp, &self.redis_path)?;
        Ok(())
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
        let Ok(raw) = fs::read_to_string(&self.db_path) else {
            return Vec::new();
        };
        serde_json::from_str::<Vec<DbConfig>>(&raw).unwrap_or_else(|error| {
            eprintln!("[store] db.json 解析失败，已忽略: {error}");
            Vec::new()
        })
    }

    fn write_db(&self, list: &[DbConfig]) -> Result<()> {
        let json = serde_json::to_string_pretty(list)?;
        let temp = self.db_path.with_extension("json.tmp");
        fs::write(&temp, json)?;
        fs::rename(&temp, &self.db_path)?;
        Ok(())
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
