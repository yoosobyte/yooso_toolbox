use std::time::Instant;

use mysql_async::prelude::*;
use mysql_async::{Conn, Params, Row, Value};
use tauri::State;

use crate::core::models::{DbColumnInfo, DbQueryResult};
use crate::AppState;

use super::sql::quote_ident;
use super::{connection, db_err, timed, QUERY_TIMEOUT};

pub(super) fn value_text(value: Value) -> Option<String> {
    match value {
        Value::NULL => None,
        Value::Bytes(bytes) => Some(String::from_utf8_lossy(&bytes).to_string()),
        Value::Int(number) => Some(number.to_string()),
        Value::UInt(number) => Some(number.to_string()),
        Value::Float(number) => Some(number.to_string()),
        Value::Double(number) => Some(number.to_string()),
        Value::Date(year, month, day, hour, minute, second, micros) => {
            let mut text = format!("{year:04}-{month:02}-{day:02}");
            if hour != 0 || minute != 0 || second != 0 || micros != 0 {
                text.push_str(&format!(" {hour:02}:{minute:02}:{second:02}"));
                if micros != 0 {
                    text.push_str(&format!(".{micros:06}"));
                }
            }
            Some(text)
        }
        Value::Time(negative, days, hours, minutes, seconds, micros) => {
            let mut text = if negative {
                "-".to_string()
            } else {
                String::new()
            };
            if days > 0 {
                text.push_str(&format!("{days} "));
            }
            text.push_str(&format!("{hours:02}:{minutes:02}:{seconds:02}"));
            if micros != 0 {
                text.push_str(&format!(".{micros:06}"));
            }
            Some(text)
        }
    }
}

pub(super) async fn run_query(
    conn: &mut Conn,
    sql: String,
    total: Option<u64>,
) -> Result<DbQueryResult, String> {
    let started = Instant::now();
    let mut result = timed(conn.query_iter(sql)).await?;

    let columns: Vec<DbColumnInfo> = result
        .columns_ref()
        .iter()
        .map(|column| DbColumnInfo {
            name: column.name_str().to_string(),
            type_name: format!("{:?}", column.column_type()),
        })
        .collect();

    let rows: Vec<Row> = match tokio::time::timeout(QUERY_TIMEOUT, result.collect::<Row>()).await {
        Ok(Ok(rows)) => rows,
        Ok(Err(error)) => return Err(db_err(error)),
        Err(_) => return Err("读取 MySQL 结果超时".to_string()),
    };

    let affected_rows = result.affected_rows();
    let last_insert_id = result.last_insert_id();
    let info = result.info().to_string();
    let elapsed_ms = started.elapsed().as_millis() as u64;

    let rows = rows
        .into_iter()
        .map(|row| row.unwrap().into_iter().map(value_text).collect())
        .collect();

    Ok(DbQueryResult {
        columns,
        rows,
        affected_rows,
        last_insert_id,
        elapsed_ms,
        message: if info.is_empty() { None } else { Some(info) },
        total,
        primary_key: Vec::new(),
    })
}

pub(super) async fn run_query_params(
    conn: &mut Conn,
    sql: String,
    params: Params,
    total: Option<u64>,
    primary_key: Vec<String>,
) -> Result<DbQueryResult, String> {
    let started = Instant::now();
    let mut result = timed(conn.exec_iter(sql, params)).await?;

    let columns: Vec<DbColumnInfo> = result
        .columns_ref()
        .iter()
        .map(|column| DbColumnInfo {
            name: column.name_str().to_string(),
            type_name: format!("{:?}", column.column_type()),
        })
        .collect();

    let rows: Vec<Row> = match tokio::time::timeout(QUERY_TIMEOUT, result.collect::<Row>()).await {
        Ok(Ok(rows)) => rows,
        Ok(Err(error)) => return Err(db_err(error)),
        Err(_) => return Err("读取 MySQL 结果超时".to_string()),
    };

    let affected_rows = result.affected_rows();
    let last_insert_id = result.last_insert_id();
    let info = result.info().to_string();
    let elapsed_ms = started.elapsed().as_millis() as u64;

    let rows = rows
        .into_iter()
        .map(|row| row.unwrap().into_iter().map(value_text).collect())
        .collect();

    Ok(DbQueryResult {
        columns,
        rows,
        affected_rows,
        last_insert_id,
        elapsed_ms,
        message: if info.is_empty() { None } else { Some(info) },
        total,
        primary_key,
    })
}

pub(super) async fn primary_key_columns(conn: &mut Conn, database: &str, table: &str) -> Vec<String> {
    let query = "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE \
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' \
                 ORDER BY ORDINAL_POSITION";
    let rows: Vec<Row> = match timed(conn.exec(query, (database, table))).await {
        Ok(rows) => rows,
        Err(_) => return Vec::new(),
    };
    rows.into_iter()
        .filter_map(|row| row.get::<String, _>(0))
        .collect()
}

pub(super) async fn exec_affected(conn: &mut Conn, sql: String, params: Params) -> Result<u64, String> {
    let result = timed(conn.exec_iter(sql, params)).await?;
    let affected = result.affected_rows();
    timed(result.drop_result()).await?;
    Ok(affected)
}

#[tauri::command]
pub async fn db_query(
    state: State<'_, AppState>,
    id: String,
    database: Option<String>,
    sql: String,
) -> Result<DbQueryResult, String> {
    let sql = sql.trim().to_string();
    if sql.is_empty() {
        return Err("SQL 不能为空".to_string());
    }

    let connection = connection(&state, &id).await?;
    let mut conn = connection.conn.lock().await;
    if let Some(database) = database.as_deref().filter(|value| !value.trim().is_empty()) {
        timed(conn.query_drop(format!("USE {}", quote_ident(database)))).await?;
    }
    run_query(&mut conn, sql, None).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_values() {
        assert_eq!(value_text(Value::NULL), None);
        assert_eq!(value_text(Value::Int(-12)), Some("-12".into()));
        assert_eq!(value_text(Value::UInt(12)), Some("12".into()));
        assert_eq!(
            value_text(Value::Bytes(b"hello".to_vec())),
            Some("hello".into())
        );
        assert_eq!(
            value_text(Value::Date(2026, 5, 8, 0, 0, 0, 0)),
            Some("2026-05-08".into())
        );
        assert_eq!(
            value_text(Value::Date(2026, 5, 8, 9, 3, 2, 0)),
            Some("2026-05-08 09:03:02".into())
        );
    }
}
