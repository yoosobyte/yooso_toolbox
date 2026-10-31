//! 键浏览：SCAN 游标分页，并批量补充 TYPE / TTL 信息。

use redis::Value;
use tauri::State;

use crate::core::models::{RedisKeyInfo, RedisScanResult};
use crate::AppState;

use super::value::value_text;
use super::{get_connection, with_timeout, RedisConnection, R};

#[tauri::command]
pub async fn redis_scan(
    state: State<'_, AppState>,
    id: String,
    cursor: String,
    pattern: String,
    count: u32,
) -> R<RedisScanResult> {
    let connection = get_connection(&state, &id).await?;
    scan_impl(&connection, cursor, pattern, count).await
}

pub(super) async fn scan_impl(
    connection: &RedisConnection,
    cursor: String,
    pattern: String,
    count: u32,
) -> R<RedisScanResult> {
    let mut guard = connection.conn.lock().await;
    let pattern = {
        let trimmed = pattern.trim();
        if trimmed.is_empty() {
            "*".to_string()
        } else {
            trimmed.to_string()
        }
    };
    let count = count.clamp(10, 1000);
    let (next, keys): (String, Vec<String>) = with_timeout(
        redis::cmd("SCAN")
            .arg(&cursor)
            .arg("MATCH")
            .arg(pattern)
            .arg("COUNT")
            .arg(count)
            .query_async(&mut *guard),
    )
    .await?;

    let mut info = Vec::with_capacity(keys.len());
    if !keys.is_empty() {
        let mut pipe = redis::pipe();
        for key in &keys {
            pipe.cmd("TYPE").arg(key);
            pipe.cmd("TTL").arg(key);
        }
        let values: Vec<Value> = with_timeout(pipe.query_async(&mut *guard)).await?;
        for (index, key) in keys.into_iter().enumerate() {
            let kind = values.get(index * 2).map(value_text).unwrap_or_default();
            let ttl = match values.get(index * 2 + 1) {
                Some(Value::Int(ttl)) => *ttl,
                _ => -2,
            };
            info.push(RedisKeyInfo { key, kind, ttl });
        }
    }

    Ok(RedisScanResult {
        cursor: next,
        keys: info,
    })
}
