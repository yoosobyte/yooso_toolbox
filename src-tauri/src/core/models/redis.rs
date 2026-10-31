use serde::{Deserialize, Serialize};

use super::common::default_true;

/* ------------------------------------------------------------------ */
/* Redis                                                              */
/* ------------------------------------------------------------------ */

fn default_redis_port() -> u16 {
    6379
}

/// 一条 Redis 连接配置，存放在应用配置目录的 redis.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisConfig {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub host: String,
    #[serde(default = "default_redis_port")]
    pub port: u16,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default = "default_true")]
    pub save_password: bool,
    #[serde(default)]
    pub db: u16,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub last_used_at: Option<i64>,
    #[serde(default)]
    pub created_at: Option<i64>,
}

impl RedisConfig {
    pub fn target(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisConnectInfo {
    pub server: String,
    pub version: String,
    pub db: u16,
}

/// SCAN 返回的一行
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyInfo {
    pub key: String,
    pub kind: String,
    /// -1 表示不过期，-2 表示键不存在
    pub ttl: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisScanResult {
    pub cursor: String,
    pub keys: Vec<RedisKeyInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisField {
    pub field: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisZItem {
    pub member: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisStreamEntry {
    pub id: String,
    pub fields: Vec<RedisField>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RedisValue {
    None,
    String {
        value: String,
        truncated: bool,
    },
    Hash {
        entries: Vec<RedisField>,
        truncated: bool,
    },
    List {
        items: Vec<String>,
        truncated: bool,
    },
    Set {
        items: Vec<String>,
        truncated: bool,
    },
    Zset {
        items: Vec<RedisZItem>,
        truncated: bool,
    },
    Stream {
        entries: Vec<RedisStreamEntry>,
        truncated: bool,
    },
    Other {
        #[serde(rename = "valueType")]
        value_type: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyDetail {
    pub key: String,
    pub kind: String,
    pub ttl: i64,
    pub size: Option<u64>,
    pub value: RedisValue,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisCommandReply {
    pub output: String,
}
