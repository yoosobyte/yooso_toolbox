//! 原生命令执行：命令拆分、SELECT 拦截与回复格式化。

use redis::Value;
use tauri::State;

use crate::core::models::RedisCommandReply;
use crate::AppState;

use super::{get_connection, with_timeout, RedisConnection, R};

pub(super) fn format_value(value: &Value, depth: usize) -> String {
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

pub(super) fn parse_command(input: &str) -> R<Vec<String>> {
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

#[tauri::command]
pub async fn redis_command(
    state: State<'_, AppState>,
    id: String,
    command: String,
) -> R<RedisCommandReply> {
    let connection = get_connection(&state, &id).await?;
    command_impl(&connection, command).await
}

pub(super) async fn command_impl(
    connection: &RedisConnection,
    command: String,
) -> R<RedisCommandReply> {
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
