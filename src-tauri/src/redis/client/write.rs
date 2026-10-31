//! 写操作：SET / DEL / EXPIRE / RENAME。

use tauri::State;

use crate::AppState;

use super::{get_connection, with_timeout, RedisConnection, R};

#[tauri::command]
pub async fn redis_set_string(
    state: State<'_, AppState>,
    id: String,
    key: String,
    value: String,
    ttl_seconds: Option<i64>,
    keep_ttl: bool,
    nx: bool,
) -> R<()> {
    let connection = get_connection(&state, &id).await?;
    set_string_impl(&connection, key, value, ttl_seconds, keep_ttl, nx).await
}

pub(super) async fn set_string_impl(
    connection: &RedisConnection,
    key: String,
    value: String,
    ttl_seconds: Option<i64>,
    keep_ttl: bool,
    nx: bool,
) -> R<()> {
    let mut guard = connection.conn.lock().await;

    let mut command = redis::cmd("SET");
    command.arg(&key).arg(&value);
    if nx {
        command.arg("NX");
    }
    match ttl_seconds {
        Some(ttl) if ttl > 0 => {
            command.arg("EX").arg(ttl);
        }
        _ => {
            if keep_ttl {
                command.arg("KEEPTTL");
            }
        }
    }

    let result: Option<String> = with_timeout(command.query_async(&mut *guard)).await?;
    if nx && result.is_none() {
        return Err("键已存在".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn redis_delete(state: State<'_, AppState>, id: String, keys: Vec<String>) -> R<u64> {
    let connection = get_connection(&state, &id).await?;
    delete_impl(&connection, keys).await
}

pub(super) async fn delete_impl(connection: &RedisConnection, keys: Vec<String>) -> R<u64> {
    if keys.is_empty() {
        return Ok(0);
    }
    let mut guard = connection.conn.lock().await;
    let mut command = redis::cmd("DEL");
    for key in &keys {
        command.arg(key);
    }
    let count: i64 = with_timeout(command.query_async(&mut *guard)).await?;
    Ok(count.max(0) as u64)
}

#[tauri::command]
pub async fn redis_expire(
    state: State<'_, AppState>,
    id: String,
    key: String,
    ttl_seconds: i64,
) -> R<()> {
    let connection = get_connection(&state, &id).await?;
    expire_impl(&connection, key, ttl_seconds).await
}

pub(super) async fn expire_impl(
    connection: &RedisConnection,
    key: String,
    ttl_seconds: i64,
) -> R<()> {
    let mut guard = connection.conn.lock().await;
    let result: i64 = if ttl_seconds < 0 {
        with_timeout(redis::cmd("PERSIST").arg(&key).query_async(&mut *guard)).await?
    } else {
        with_timeout(
            redis::cmd("EXPIRE")
                .arg(&key)
                .arg(ttl_seconds)
                .query_async(&mut *guard),
        )
        .await?
    };
    if result == 0 {
        return Err("键不存在，或过期时间没有变化".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn redis_rename(
    state: State<'_, AppState>,
    id: String,
    key: String,
    new_key: String,
) -> R<()> {
    let connection = get_connection(&state, &id).await?;
    rename_impl(&connection, key, new_key).await
}

pub(super) async fn rename_impl(
    connection: &RedisConnection,
    key: String,
    new_key: String,
) -> R<()> {
    if new_key.trim().is_empty() {
        return Err("新键名不能为空".to_string());
    }
    let mut guard = connection.conn.lock().await;
    with_timeout(
        redis::cmd("RENAME")
            .arg(&key)
            .arg(&new_key)
            .query_async::<()>(&mut *guard),
    )
    .await
}
