use serde::{Deserialize, Serialize};

use super::common::{default_true, default_username};

/* ------------------------------- MySQL / DB ------------------------------ */

fn default_db_port() -> u16 {
    3306
}

fn default_db_kind() -> String {
    "mysql".to_string()
}

/// 数据库连接配置（目前只有 MySQL），存放在 db.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbConfig {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default = "default_db_kind")]
    pub kind: String,
    #[serde(default)]
    pub host: String,
    #[serde(default = "default_db_port")]
    pub port: u16,
    #[serde(default = "default_username")]
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default = "default_true")]
    pub save_password: bool,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub last_used_at: Option<i64>,
    #[serde(default)]
    pub created_at: Option<i64>,
}

impl DbConfig {
    pub fn target(&self) -> String {
        format!("{}@{}:{}", self.username, self.host, self.port)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbConnectInfo {
    pub server: String,
    pub version: String,
    pub database: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbTableInfo {
    pub name: String,
    /// BASE TABLE / VIEW
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbColumnInfo {
    pub name: String,
    pub type_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbFilter {
    pub column: String,
    /// eq / neq / contains / notContains / startsWith / endsWith / gt / gte / lt / lte /
    /// isNull / isNotNull / in / notIn
    pub operator: String,
    #[serde(default)]
    pub value: Option<String>,
    /// 当前条件与上一个条件之间的连接符：and / or
    #[serde(default)]
    pub conjunction: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbTableOptions {
    pub name: String,
    pub comment: String,
    pub engine: String,
    pub auto_increment: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbKey {
    pub column: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbQueryResult {
    pub columns: Vec<DbColumnInfo>,
    pub rows: Vec<Vec<Option<String>>>,
    pub affected_rows: u64,
    pub last_insert_id: Option<u64>,
    pub elapsed_ms: u64,
    pub message: Option<String>,
    /// 表数据分页的总行数（普通 SQL 为 None）
    pub total: Option<u64>,
    /// 主键列（用于行编辑 / 删除）
    pub primary_key: Vec<String>,
}
