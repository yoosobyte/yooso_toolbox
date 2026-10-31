//! 类型读取与值解析：读 TYPE / TTL / 元素数，并把 string / hash / list / set /
//! zset / stream 的原始回复组装成 `RedisValue`。

use redis::aio::MultiplexedConnection;
use redis::Value;
use tauri::State;

use crate::core::models::{RedisField, RedisKeyDetail, RedisStreamEntry, RedisValue, RedisZItem};
use crate::AppState;

use super::{get_connection, with_timeout, RedisConnection, R};

const VALUE_LIMIT: usize = 500;
const STREAM_LIMIT: usize = 100;

pub(super) fn value_text(value: &Value) -> String {
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

pub(super) async fn load_detail(connection: &RedisConnection, key: String) -> R<RedisKeyDetail> {
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
