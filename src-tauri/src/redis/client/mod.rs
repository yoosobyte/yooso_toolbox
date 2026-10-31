//! Redis 客户端：连接管理 + 键浏览 + 通用命令。
//!
//! 所有操作都串行化在单条 `MultiplexedConnection` 上（每个连接一把 tokio Mutex），
//! 这样 SELECT 切换 DB 时不会和并发命令串台；GUI 场景下并发很低，足够用。
//!
//! 子模块划分：本文件负责连接与配置命令，`scan` 负责键扫描，`value` 负责类型读取
//! 与值组装，`write` 负责写操作，`command` 负责原生命令执行。

mod command;
mod scan;
mod value;
mod write;

pub use command::*;
pub use scan::*;
pub use value::*;
pub use write::*;

#[cfg(test)]
mod tests;

use std::sync::Arc;
use std::time::Duration;

use redis::aio::MultiplexedConnection;
use redis::{ConnectionAddr, ConnectionInfo, ProtocolVersion, RedisConnectionInfo};
use tauri::State;
use tokio::sync::Mutex;

use crate::core::models::{RedisConfig, RedisConnectInfo};
use crate::AppState;

const TIMEOUT: Duration = Duration::from_secs(15);

type R<T> = Result<T, String>;

pub struct RedisConnection {
    pub conn: Mutex<MultiplexedConnection>,
    pub config: RedisConfig,
}

async fn open(config: &RedisConfig) -> R<MultiplexedConnection> {
    let info = ConnectionInfo {
        addr: ConnectionAddr::Tcp(config.host.clone(), config.port),
        redis: RedisConnectionInfo {
            db: config.db as i64,
            username: config.username.clone().filter(|value| !value.is_empty()),
            password: config.password.clone().filter(|value| !value.is_empty()),
            protocol: ProtocolVersion::RESP2,
        },
    };
    let client = redis::Client::open(info).map_err(|error| format!("创建连接失败：{error}"))?;
    match tokio::time::timeout(TIMEOUT, client.get_multiplexed_async_connection()).await {
        Ok(Ok(connection)) => Ok(connection),
        Ok(Err(error)) => Err(format!("连接 Redis 失败：{error}")),
        Err(_) => Err("连接 Redis 超时".to_string()),
    }
}

pub(super) async fn with_timeout<T>(
    future: impl std::future::Future<Output = redis::RedisResult<T>>,
) -> R<T> {
    match tokio::time::timeout(TIMEOUT, future).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(format!("Redis 错误：{error}")),
        Err(_) => Err("Redis 操作超时".to_string()),
    }
}

pub(super) async fn get_connection(
    state: &State<'_, AppState>,
    id: &str,
) -> R<Arc<RedisConnection>> {
    state
        .redis
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or_else(|| "连接已断开，请重新连接".to_string())
}

/* ------------------------------------------------------------------ */
/* 连接配置                                                             */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn redis_config_list(state: State<'_, AppState>) -> Result<Vec<RedisConfig>, String> {
    Ok(state.store.redis_list())
}

#[tauri::command]
pub async fn redis_config_upsert(
    state: State<'_, AppState>,
    config: RedisConfig,
) -> Result<Vec<RedisConfig>, String> {
    state
        .store
        .redis_upsert(config)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn redis_config_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<RedisConfig>, String> {
    state
        .store
        .redis_delete(&id)
        .map_err(|error| error.to_string())
}

/* ------------------------------------------------------------------ */
/* 连接                                                                 */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn redis_test(config: RedisConfig) -> Result<RedisConnectInfo, String> {
    let mut connection = open(&config).await?;
    let _: String = with_timeout(redis::cmd("PING").query_async(&mut connection)).await?;
    let info: String = with_timeout(
        redis::cmd("INFO")
            .arg("server")
            .query_async(&mut connection),
    )
    .await
    .unwrap_or_default();
    let version = info
        .lines()
        .find_map(|line| line.strip_prefix("redis_version:"))
        .unwrap_or("unknown")
        .trim()
        .to_string();
    Ok(RedisConnectInfo {
        server: config.target(),
        version,
        db: config.db,
    })
}

#[tauri::command]
pub async fn redis_connect(
    state: State<'_, AppState>,
    config: RedisConfig,
) -> Result<RedisConnectInfo, String> {
    let mut connection = open(&config).await?;
    let _: String = with_timeout(redis::cmd("PING").query_async(&mut connection)).await?;
    let info: String = with_timeout(
        redis::cmd("INFO")
            .arg("server")
            .query_async(&mut connection),
    )
    .await
    .unwrap_or_default();
    let version = info
        .lines()
        .find_map(|line| line.strip_prefix("redis_version:"))
        .unwrap_or("unknown")
        .trim()
        .to_string();

    let id = config.id.clone();
    state.redis.lock().await.insert(
        id.clone(),
        Arc::new(RedisConnection {
            conn: Mutex::new(connection),
            config: config.clone(),
        }),
    );
    let _ = state.store.redis_touch(&id);

    Ok(RedisConnectInfo {
        server: config.target(),
        version,
        db: config.db,
    })
}

#[tauri::command]
pub async fn redis_disconnect(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.redis.lock().await.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn redis_select(state: State<'_, AppState>, id: String, db: u16) -> Result<(), String> {
    let connection = get_connection(&state, &id).await?;
    let mut guard = connection.conn.lock().await;
    with_timeout(redis::cmd("SELECT").arg(db).query_async::<()>(&mut *guard)).await
}
