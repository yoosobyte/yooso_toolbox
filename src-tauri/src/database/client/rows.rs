use mysql_async::prelude::*;
use mysql_async::{Params, Value};
use tauri::State;

use crate::core::models::{DbFilter, DbKey, DbQueryResult};
use crate::AppState;

use super::query::{exec_affected, primary_key_columns, run_query_params};
use super::sql::{
    filter_clause, insert_row_sql, qualified, quote_ident, table_data_sql, where_for_keys,
};
use super::{connection, timed, MAX_PAGE_SIZE};

#[tauri::command]
pub async fn db_table_data(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    limit: u32,
    offset: u32,
    order_by: Option<String>,
    order_dir: Option<String>,
    filters: Option<Vec<DbFilter>>,
    conjunction: Option<String>,
) -> Result<DbQueryResult, String> {
    let connection = connection(&state, &id).await?;
    let mut conn = connection.conn.lock().await;
    let target = qualified(&database, &table);
    let limit = limit.clamp(1, MAX_PAGE_SIZE);
    let offset = offset.max(0);

    let primary_key = primary_key_columns(&mut conn, &database, &table).await;
    let filters = filters.unwrap_or_default();
    let (where_sql, params) = filter_clause(&filters, conjunction.as_deref());

    let count_sql = format!("SELECT COUNT(*) FROM {target}{where_sql}");
    let total: Option<u64> =
        match timed(conn.exec_first::<u64, _, _>(count_sql, Params::Positional(params.clone())))
            .await
        {
            Ok(value) => value,
            Err(_) => None,
        };

    let sql = table_data_sql(
        &target,
        &where_sql,
        limit,
        offset,
        order_by.as_deref(),
        order_dir.as_deref(),
    );
    run_query_params(
        &mut conn,
        sql,
        Params::Positional(params),
        total,
        primary_key,
    )
    .await
}

#[tauri::command]
pub async fn db_update_cell(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    column: String,
    value: Option<String>,
    keys: Vec<DbKey>,
) -> Result<u64, String> {
    let column = column.trim().to_string();
    if column.is_empty() {
        return Err("列名不能为空".to_string());
    }
    let (where_sql, key_params) = where_for_keys(&keys);
    if where_sql.is_empty() {
        return Err("缺少主键条件，无法更新".to_string());
    }

    let connection = connection(&state, &id).await?;
    let mut conn = connection.conn.lock().await;
    let target = qualified(&database, &table);
    let mut params = Vec::with_capacity(key_params.len() + 1);
    params.push(match value {
        Some(value) => Value::Bytes(value.into_bytes()),
        None => Value::NULL,
    });
    params.extend(key_params);

    let sql = format!(
        "UPDATE {target} SET {} = ? WHERE {where_sql} LIMIT 1",
        quote_ident(&column)
    );
    exec_affected(&mut conn, sql, Params::Positional(params)).await
}

#[tauri::command]
pub async fn db_delete_rows(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    rows: Vec<Vec<DbKey>>,
) -> Result<u64, String> {
    let mut groups = Vec::new();
    let mut params = Vec::new();
    for keys in rows {
        let (where_sql, mut key_params) = where_for_keys(&keys);
        if where_sql.is_empty() {
            continue;
        }
        groups.push(format!("({where_sql})"));
        params.append(&mut key_params);
    }
    if groups.is_empty() {
        return Err("没有可删除的行（缺少主键）".to_string());
    }

    let connection = connection(&state, &id).await?;
    let mut conn = connection.conn.lock().await;
    let target = qualified(&database, &table);
    let sql = format!("DELETE FROM {target} WHERE {}", groups.join(" OR "));
    exec_affected(&mut conn, sql, Params::Positional(params)).await
}

#[tauri::command]
pub async fn db_insert_row(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    values: Vec<DbKey>,
) -> Result<u64, String> {
    let connection = connection(&state, &id).await?;
    let mut conn = connection.conn.lock().await;
    let target = qualified(&database, &table);
    let (sql, params) = insert_row_sql(&target, &values);
    exec_affected(&mut conn, sql, Params::Positional(params)).await
}
