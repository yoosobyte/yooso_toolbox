//! Redis 客户端：连接管理 + 键浏览 + 通用命令。
//!
//! 所有操作都串行化在单条 `MultiplexedConnection` 上（每个连接一把 tokio Mutex），
//! 这样 SELECT 切换 DB 时不会和并发命令串台；GUI 场景下并发很低，足够用。

use std::sync::Arc;
use std::time::Duration;

use redis::aio::MultiplexedConnection;
use redis::{ConnectionAddr, ConnectionInfo, ProtocolVersion, RedisConnectionInfo, Value};
use tauri::State;
use tokio::sync::Mutex;

use crate::core::models::{
    RedisCommandReply, RedisConfig, RedisConnectInfo, RedisField, RedisKeyDetail, RedisKeyInfo,
    RedisScanResult, RedisStreamEntry, RedisValue, RedisZItem,
};
use crate::AppState;

const TIMEOUT: Duration = Duration::from_secs(15);
const VALUE_LIMIT: usize = 500;
const STREAM_LIMIT: usize = 100;

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

async fn with_timeout<T>(future: impl std::future::Future<Output = redis::RedisResult<T>>) -> R<T> {
    match tokio::time::timeout(TIMEOUT, future).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(format!("Redis 错误：{error}")),
        Err(_) => Err("Redis 操作超时".to_string()),
    }
}

async fn get_connection(state: &State<'_, AppState>, id: &str) -> R<Arc<RedisConnection>> {
    state
        .redis
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or_else(|| "连接已断开，请重新连接".to_string())
}

fn value_text(value: &Value) -> String {
    match value {
        Value::Nil => String::new(),
        Value::Int(number) => number.to_string(),
        Value::BulkString(bytes) => String::from_utf8_lossy(bytes).to_string(),
        Value::SimpleString(text) => text.clone(),
        Value::Okay => "OK".to_string(),
        Value::Double(number) => number.to_string(),
        Value::Boolean(flag) => flag.to_string(),
        Value::VerbatimString { text, .. } => text.clone(),
        other => format!("{other:?}"),
    }
}

fn format_value(value: &Value, depth: usize) -> String {
    let pad = "  ".repeat(depth);
    match value {
        Value::Nil => "(nil)".to_string(),
        Value::Int(number) => number.to_string(),
        Value::BulkString(bytes) => String::from_utf8_lossy(bytes).to_string(),
        Value::SimpleString(text) => text.clone(),
        Value::Okay => "OK".to_string(),
        Value::Double(number) => number.to_string(),
        Value::Boolean(flag) => flag.to_string(),
        Value::BigNumber(number) => number.to_string(),
        Value::VerbatimString { text, .. } => text.clone(),
        Value::ServerError(error) => format!("(error) {error:?}"),
        Value::Array(items) => {
            if items.is_empty() {
                "(empty array)".to_string()
            } else {
                items
                    .iter()
                    .enumerate()
                    .map(|(index, item)| {
                        format!("{pad}{}) {}", index + 1, format_value(item, depth + 1))
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        }
        Value::Set(items) => format_value(&Value::Array(items.clone()), depth),
        Value::Map(pairs) => {
            if pairs.is_empty() {
                "(empty map)".to_string()
            } else {
                pairs
                    .iter()
                    .enumerate()
                    .map(|(index, (key, item))| {
                        format!(
                            "{pad}{}) {} => {}",
                            index + 1,
                            format_value(key, depth + 1),
                            format_value(item, depth + 1)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        }
        other => format!("{other:?}"),
    }
}

fn parse_command(input: &str) -> R<Vec<String>> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;

    for character in input.chars() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }
        match quote {
            Some(mark) => {
                if character == '\\' && mark == '"' {
                    escaped = true;
                } else if character == mark {
                    quote = None;
                } else {
                    current.push(character);
                }
            }
            None => match character {
                '\'' | '"' => quote = Some(character),
                '\\' => escaped = true,
                value if value.is_whitespace() => {
                    if !current.is_empty() {
                        tokens.push(std::mem::take(&mut current));
                    }
                }
                value => current.push(value),
            },
        }
    }

    if escaped {
        current.push('\\');
    }
    if quote.is_some() {
        return Err("命令里的引号没有闭合".to_string());
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    if tokens.is_empty() {
        return Err("请输入 Redis 命令".to_string());
    }
    Ok(tokens)
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

/* ------------------------------------------------------------------ */
/* 键浏览                                                               */
/* ------------------------------------------------------------------ */

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

async fn scan_impl(
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

async fn key_size(guard: &mut MultiplexedConnection, kind: &str, key: &str) -> Option<u64> {
    let command = match kind {
        "string" => "STRLEN",
        "hash" => "HLEN",
        "list" => "LLEN",
        "set" => "SCARD",
        "zset" => "ZCARD",
        "stream" => "XLEN",
        _ => return None,
    };
    let result: redis::RedisResult<i64> = redis::cmd(command).arg(key).query_async(guard).await;
    result.ok().and_then(|value| u64::try_from(value).ok())
}

fn parse_stream(value: Value) -> Vec<RedisStreamEntry> {
    let Value::Array(entries) = value else {
        return Vec::new();
    };
    entries
        .into_iter()
        .filter_map(|entry| {
            let Value::Array(parts) = entry else {
                return None;
            };
            let mut iter = parts.into_iter();
            let id = value_text(&iter.next()?);
            let Value::Array(fields) = iter.next()? else {
                return None;
            };
            let mut out = Vec::new();
            let mut fields = fields.into_iter();
            while let (Some(field), Some(value)) = (fields.next(), fields.next()) {
                out.push(RedisField {
                    field: value_text(&field),
                    value: value_text(&value),
                });
            }
            Some(RedisStreamEntry { id, fields: out })
        })
        .collect()
}

#[tauri::command]
pub async fn redis_key_detail(
    state: State<'_, AppState>,
    id: String,
    key: String,
) -> R<RedisKeyDetail> {
    let connection = get_connection(&state, &id).await?;
    load_detail(&connection, key).await
}

async fn load_detail(connection: &RedisConnection, key: String) -> R<RedisKeyDetail> {
    let mut guard = connection.conn.lock().await;

    let kind: String = with_timeout(redis::cmd("TYPE").arg(&key).query_async(&mut *guard)).await?;
    let ttl: i64 = with_timeout(redis::cmd("TTL").arg(&key).query_async(&mut *guard)).await?;
    let size = key_size(&mut guard, &kind, &key).await;

    let value = match kind.as_str() {
        "string" => {
            let raw: Option<String> =
                with_timeout(redis::cmd("GET").arg(&key).query_async(&mut *guard)).await?;
            RedisValue::String {
                value: raw.unwrap_or_default(),
                truncated: false,
            }
        }
        "hash" => {
            let flat: Vec<String> =
                with_timeout(redis::cmd("HGETALL").arg(&key).query_async(&mut *guard)).await?;
            let mut entries = Vec::new();
            let mut chunks = flat.chunks(2);
            while let Some(pair) = chunks.next() {
                if pair.len() < 2 {
                    break;
                }
                entries.push(RedisField {
                    field: pair[0].clone(),
                    value: pair[1].clone(),
                });
                if entries.len() >= VALUE_LIMIT {
                    break;
                }
            }
            let truncated = size.is_some_and(|total| total > entries.len() as u64);
            RedisValue::Hash { entries, truncated }
        }
        "list" => {
            let items: Vec<String> = with_timeout(
                redis::cmd("LRANGE")
                    .arg(&key)
                    .arg(0)
                    .arg(VALUE_LIMIT - 1)
                    .query_async(&mut *guard),
            )
            .await?;
            let truncated = size.is_some_and(|total| total > items.len() as u64);
            RedisValue::List { items, truncated }
        }
        "set" => {
            let mut items: Vec<String> =
                with_timeout(redis::cmd("SMEMBERS").arg(&key).query_async(&mut *guard)).await?;
            let truncated = size.is_some_and(|total| total > items.len() as u64);
            items.truncate(VALUE_LIMIT);
            RedisValue::Set { items, truncated }
        }
        "zset" => {
            let flat: Vec<String> = with_timeout(
                redis::cmd("ZRANGE")
                    .arg(&key)
                    .arg(0)
                    .arg(VALUE_LIMIT - 1)
                    .arg("WITHSCORES")
                    .query_async(&mut *guard),
            )
            .await?;
            let mut items: Vec<RedisZItem> = flat
                .chunks(2)
                .filter_map(|pair| {
                    if pair.len() < 2 {
                        return None;
                    }
                    Some(RedisZItem {
                        member: pair[0].clone(),
                        score: pair[1].parse::<f64>().unwrap_or(0.0),
                    })
                })
                .collect();
            let truncated = size.is_some_and(|total| total > items.len() as u64);
            items.truncate(VALUE_LIMIT);
            RedisValue::Zset { items, truncated }
        }
        "stream" => {
            let raw: Value = with_timeout(
                redis::cmd("XRANGE")
                    .arg(&key)
                    .arg("-")
                    .arg("+")
                    .arg("COUNT")
                    .arg(STREAM_LIMIT)
                    .query_async(&mut *guard),
            )
            .await?;
            let entries = parse_stream(raw);
            let truncated = size.is_some_and(|total| total > entries.len() as u64);
            RedisValue::Stream { entries, truncated }
        }
        "none" => RedisValue::None,
        other => RedisValue::Other {
            value_type: other.to_string(),
        },
    };

    Ok(RedisKeyDetail {
        key,
        kind,
        ttl,
        size,
        value,
    })
}

/* ------------------------------------------------------------------ */
/* 编辑                                                                 */
/* ------------------------------------------------------------------ */

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

async fn set_string_impl(
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

async fn delete_impl(connection: &RedisConnection, keys: Vec<String>) -> R<u64> {
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

async fn expire_impl(connection: &RedisConnection, key: String, ttl_seconds: i64) -> R<()> {
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

async fn rename_impl(connection: &RedisConnection, key: String, new_key: String) -> R<()> {
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

#[tauri::command]
pub async fn redis_command(
    state: State<'_, AppState>,
    id: String,
    command: String,
) -> R<RedisCommandReply> {
    let connection = get_connection(&state, &id).await?;
    command_impl(&connection, command).await
}

async fn command_impl(connection: &RedisConnection, command: String) -> R<RedisCommandReply> {
    let tokens = parse_command(&command)?;
    if tokens[0].eq_ignore_ascii_case("SELECT") {
        return Err("请使用顶部的 DB 选择器切换数据库".to_string());
    }
    let mut guard = connection.conn.lock().await;

    let mut cmd = redis::cmd(&tokens[0]);
    for token in &tokens[1..] {
        cmd.arg(token);
    }
    let value: Value = with_timeout(cmd.query_async(&mut *guard)).await?;
    Ok(RedisCommandReply {
        output: format_value(&value, 0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> RedisConfig {
        RedisConfig {
            id: "redis-test".to_string(),
            name: "redis-test".to_string(),
            host: std::env::var("REDIS_TEST_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: std::env::var("REDIS_TEST_PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(6399),
            username: None,
            password: Some(
                std::env::var("REDIS_TEST_PASSWORD").unwrap_or_else(|_| "testpass".to_string()),
            ),
            save_password: true,
            db: 15,
            color: None,
            last_used_at: None,
            created_at: None,
        }
    }

    async fn raw(connection: &mut MultiplexedConnection, command: &str, args: &[&str]) {
        let mut cmd = redis::cmd(command);
        for arg in args {
            cmd.arg(*arg);
        }
        let _: redis::Value = cmd.query_async(connection).await.expect(command);
    }

    #[test]
    fn parses_quoted_commands() {
        assert_eq!(
            parse_command("SET key \"a b\"").unwrap(),
            vec!["SET", "key", "a b"]
        );
        assert_eq!(
            parse_command("SET key 'it is'").unwrap(),
            vec!["SET", "key", "it is"]
        );
        assert_eq!(
            parse_command("SET key \"a\\\"b\"").unwrap(),
            vec!["SET", "key", "a\"b"]
        );
        assert_eq!(parse_command("  GET   key  ").unwrap(), vec!["GET", "key"]);
        assert!(parse_command("GET \"unclosed").is_err());
        assert!(parse_command("   ").is_err());
    }

    #[test]
    fn formats_replies() {
        assert_eq!(format_value(&Value::Nil, 0), "(nil)");
        assert_eq!(format_value(&Value::Int(42), 0), "42");
        assert_eq!(
            format_value(&Value::SimpleString("OK".to_string()), 0),
            "OK"
        );
        let array = Value::Array(vec![Value::BulkString(b"a".to_vec()), Value::Int(1)]);
        let text = format_value(&array, 0);
        assert!(text.contains("1) a"));
        assert!(text.contains("2) 1"));
    }

    #[tokio::test]
    #[ignore = "需要本地 Redis（默认 127.0.0.1:6399，密码 testpass）"]
    async fn redis_roundtrip() {
        let config = test_config();
        let mut raw_conn = open(&config).await.expect("连接本地 Redis 失败");
        raw(&mut raw_conn, "FLUSHDB", &[]).await;

        raw(&mut raw_conn, "SET", &["user:1", "alice"]).await;
        raw(
            &mut raw_conn,
            "HSET",
            &["user:1:profile", "name", "Alice", "age", "20"],
        )
        .await;
        raw(&mut raw_conn, "RPUSH", &["queue", "a", "b"]).await;
        raw(&mut raw_conn, "SADD", &["tags", "rust", "redis"]).await;
        raw(&mut raw_conn, "ZADD", &["rank", "1", "a", "2", "b"]).await;
        raw(&mut raw_conn, "XADD", &["events", "*", "kind", "login"]).await;
        raw(&mut raw_conn, "EXPIRE", &["user:1", "120"]).await;

        let connection = RedisConnection {
            conn: Mutex::new(raw_conn),
            config: config.clone(),
        };

        let scan = scan_impl(&connection, "0".to_string(), "*".to_string(), 100)
            .await
            .expect("scan");
        let keys: Vec<&RedisKeyInfo> = scan.keys.iter().collect();
        assert!(keys
            .iter()
            .any(|item| item.key == "user:1" && item.kind == "string" && item.ttl > 0));
        assert!(keys
            .iter()
            .any(|item| item.key == "queue" && item.kind == "list"));
        assert!(keys
            .iter()
            .any(|item| item.key == "tags" && item.kind == "set"));
        assert!(keys
            .iter()
            .any(|item| item.key == "rank" && item.kind == "zset"));
        assert!(keys
            .iter()
            .any(|item| item.key == "events" && item.kind == "stream"));
        println!("scan: cursor={} keys={}", scan.cursor, scan.keys.len());

        let string = load_detail(&connection, "user:1".to_string())
            .await
            .expect("string detail");
        assert_eq!(string.kind, "string");
        match string.value {
            RedisValue::String { value, .. } => assert_eq!(value, "alice"),
            _ => panic!("expected string value"),
        }

        let hash = load_detail(&connection, "user:1:profile".to_string())
            .await
            .expect("hash detail");
        match hash.value {
            RedisValue::Hash { entries, .. } => {
                assert!(entries
                    .iter()
                    .any(|entry| entry.field == "name" && entry.value == "Alice"));
            }
            _ => panic!("expected hash value"),
        }

        let list = load_detail(&connection, "queue".to_string())
            .await
            .expect("list detail");
        match list.value {
            RedisValue::List { items, .. } => assert_eq!(items, vec!["a", "b"]),
            _ => panic!("expected list value"),
        }

        let set = load_detail(&connection, "tags".to_string())
            .await
            .expect("set detail");
        match set.value {
            RedisValue::Set { items, .. } => assert!(items.contains(&"rust".to_string())),
            _ => panic!("expected set value"),
        }

        let zset = load_detail(&connection, "rank".to_string())
            .await
            .expect("zset detail");
        match zset.value {
            RedisValue::Zset { items, .. } => {
                assert!(items
                    .iter()
                    .any(|item| item.member == "a" && (item.score - 1.0).abs() < f64::EPSILON));
            }
            _ => panic!("expected zset value"),
        }

        let stream = load_detail(&connection, "events".to_string())
            .await
            .expect("stream detail");
        match stream.value {
            RedisValue::Stream { entries, .. } => {
                assert_eq!(entries.len(), 1);
                assert!(entries[0]
                    .fields
                    .iter()
                    .any(|field| field.field == "kind" && field.value == "login"));
            }
            _ => panic!("expected stream value"),
        }

        set_string_impl(
            &connection,
            "new:key".to_string(),
            "hello".to_string(),
            Some(60),
            false,
            true,
        )
        .await
        .expect("set new key");
        assert!(set_string_impl(
            &connection,
            "new:key".to_string(),
            "again".to_string(),
            None,
            false,
            true
        )
        .await
        .is_err());
        set_string_impl(
            &connection,
            "new:key".to_string(),
            "updated".to_string(),
            None,
            true,
            false,
        )
        .await
        .expect("update keeping ttl");

        expire_impl(&connection, "new:key".to_string(), -1)
            .await
            .expect("persist");
        let mut guard = connection.conn.lock().await;
        let ttl: i64 = with_timeout(redis::cmd("TTL").arg("new:key").query_async(&mut *guard))
            .await
            .expect("ttl");
        drop(guard);
        assert_eq!(ttl, -1);

        expire_impl(&connection, "new:key".to_string(), 30)
            .await
            .expect("expire");
        let mut guard = connection.conn.lock().await;
        let ttl: i64 = with_timeout(redis::cmd("TTL").arg("new:key").query_async(&mut *guard))
            .await
            .expect("ttl");
        drop(guard);
        assert!(ttl > 0 && ttl <= 30);

        rename_impl(
            &connection,
            "new:key".to_string(),
            "renamed:key".to_string(),
        )
        .await
        .expect("rename");
        let renamed = load_detail(&connection, "renamed:key".to_string())
            .await
            .expect("renamed detail");
        match renamed.value {
            RedisValue::String { value, .. } => assert_eq!(value, "updated"),
            _ => panic!("expected renamed string"),
        }

        let deleted = delete_impl(&connection, vec!["renamed:key".to_string()])
            .await
            .expect("delete");
        assert_eq!(deleted, 1);

        let reply = command_impl(&connection, "HGETALL user:1:profile".to_string())
            .await
            .expect("command");
        assert!(reply.output.contains("name"));
        assert!(reply.output.contains("Alice"));

        let quoted = command_impl(&connection, "SET console:key \"a b\"".to_string())
            .await
            .expect("quoted set");
        assert_eq!(quoted.output, "OK");
        let reply = command_impl(&connection, "GET console:key".to_string())
            .await
            .expect("quoted get");
        assert_eq!(reply.output, "a b");

        let mut guard = connection.conn.lock().await;
        let _: redis::Value = redis::cmd("FLUSHDB")
            .query_async(&mut *guard)
            .await
            .expect("flush");
        drop(guard);
    }
}
