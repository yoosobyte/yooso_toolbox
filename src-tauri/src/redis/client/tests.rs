//! Redis 客户端测试：命令解析、回复格式化，以及可选的本地 Redis 往返测试。

use redis::Value;

use crate::core::models::{RedisKeyInfo, RedisValue};

use super::command::{command_impl, format_value, parse_command};
use super::scan::scan_impl;
use super::value::load_detail;
use super::write::{delete_impl, expire_impl, rename_impl, set_string_impl};
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
