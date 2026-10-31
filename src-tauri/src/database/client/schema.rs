use mysql_async::prelude::*;
use mysql_async::{Params, Row, Value};
use tauri::State;

use crate::core::models::{DbQueryResult, DbTableInfo, DbTableOptions};
use crate::AppState;

use super::query::{exec_affected, run_query, run_query_params};
use super::sql::{qualified, validate_ddl};
use super::{connection, timed};

/* ------------------------------- browse ------------------------------- */

#[tauri::command]
pub async fn db_databases(state: State<'_, AppState>, id: String) -> Result<Vec<String>, String> {
    let connection = connection(&state, &id).await?;
    let mut conn = connection.conn.lock().await;
    let mut databases: Vec<String> = timed(conn.query("SHOW DATABASES")).await?;
    databases.sort_by_key(|name| name.to_ascii_lowercase());
    Ok(databases)
}

#[tauri::command]
pub async fn db_tables(
    state: State<'_, AppState>,
    id: String,
    database: String,
) -> Result<Vec<DbTableInfo>, String> {
    let connection = connection(&state, &id).await?;
    let mut conn = connection.conn.lock().await;
    let rows: Vec<Row> = timed(conn.exec(
        "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES \
         WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
        (database,),
    ))
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let name = row.get::<String, _>(0).unwrap_or_default();
            let raw_kind = row.get::<String, _>(1).unwrap_or_default();
            let kind = if raw_kind.to_ascii_uppercase().contains("VIEW") {
                "view".to_string()
            } else {
                "table".to_string()
            };
            DbTableInfo { name, kind }
        })
        .filter(|table| !table.name.is_empty())
        .collect())
}

#[tauri::command]
pub async fn db_table_columns(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
) -> Result<DbQueryResult, String> {
    let connection = connection(&state, &id).await?;
    let mut conn = connection.conn.lock().await;
    let sql = format!("SHOW FULL COLUMNS FROM {}", qualified(&database, &table));
    run_query(&mut conn, sql, None).await
}

#[tauri::command]
pub async fn db_clone_table(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    new_table: String,
    with_data: bool,
) -> Result<u64, String> {
    let new_table = new_table.trim();
    if new_table.is_empty() {
        return Err("新表名不能为空".to_string());
    }
    let connection = connection(&state, &id).await?;
    let mut conn = connection.conn.lock().await;
    let source = qualified(&database, &table);
    let target = qualified(&database, new_table);
    exec_affected(
        &mut conn,
        format!("CREATE TABLE {target} LIKE {source}"),
        Params::Positional(Vec::new()),
    )
    .await?;
    if with_data {
        exec_affected(
            &mut conn,
            format!("INSERT INTO {target} SELECT * FROM {source}"),
            Params::Positional(Vec::new()),
        )
        .await
    } else {
        Ok(0)
    }
}

#[tauri::command]
pub async fn db_database_collation(
    state: State<'_, AppState>,
    id: String,
    database: String,
) -> Result<Option<String>, String> {
    let connection = connection(&state, &id).await?;
    let mut conn = connection.conn.lock().await;
    let result = run_query_params(
        &mut conn,
        "SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?"
            .to_string(),
        Params::Positional(vec![Value::Bytes(database.into_bytes())]),
        None,
        Vec::new(),
    )
    .await?;
    Ok(result
        .rows
        .first()
        .and_then(|row| row.first().cloned())
        .flatten())
}

#[tauri::command]
pub async fn db_table_ddl(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
) -> Result<String, String> {
    let connection = connection(&state, &id).await?;
    let mut conn = connection.conn.lock().await;
    let result = run_query(
        &mut conn,
        format!("SHOW CREATE TABLE {}", qualified(&database, &table)),
        None,
    )
    .await?;
    Ok(result
        .rows
        .first()
        .and_then(|row| row.get(1).cloned())
        .flatten()
        .unwrap_or_default())
}

#[tauri::command]
pub async fn db_table_indexes(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
) -> Result<DbQueryResult, String> {
    let connection = connection(&state, &id).await?;
    let mut conn = connection.conn.lock().await;
    run_query(
        &mut conn,
        format!("SHOW INDEX FROM {}", qualified(&database, &table)),
        None,
    )
    .await
}

#[tauri::command]
pub async fn db_table_options(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
) -> Result<DbTableOptions, String> {
    let connection = connection(&state, &id).await?;
    let mut conn = connection.conn.lock().await;
    let result = run_query_params(
        &mut conn,
        "SELECT TABLE_NAME, TABLE_COMMENT, ENGINE, AUTO_INCREMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?"
            .to_string(),
        Params::Positional(vec![
            Value::Bytes(database.into_bytes()),
            Value::Bytes(table.into_bytes()),
        ]),
        None,
        Vec::new(),
    )
    .await?;
    let row = result
        .rows
        .into_iter()
        .next()
        .ok_or_else(|| "表不存在".to_string())?;
    let value = |index: usize| row.get(index).cloned().flatten().unwrap_or_default();
    Ok(DbTableOptions {
        name: value(0),
        comment: value(1),
        engine: value(2),
        auto_increment: value(3).parse().ok(),
    })
}

#[tauri::command]
pub async fn db_exec_ddl(
    state: State<'_, AppState>,
    id: String,
    statement: String,
) -> Result<u64, String> {
    validate_ddl(&statement)?;
    let connection = connection(&state, &id).await?;
    let mut conn = connection.conn.lock().await;
    exec_affected(
        &mut conn,
        statement.trim().to_string(),
        Params::Positional(Vec::new()),
    )
    .await
}
