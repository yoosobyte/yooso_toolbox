use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};

use mysql_async::prelude::*;
use mysql_async::{Conn, OptsBuilder, Params, Row, Value};
use tauri::State;
use tokio::sync::Mutex;

use crate::core::models::{
    DbColumnInfo, DbConfig, DbConnectInfo, DbFilter, DbKey, DbQueryResult, DbTableInfo,
    DbTableOptions,
};
use crate::AppState;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const QUERY_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_PAGE_SIZE: u32 = 500;

pub struct DbConnection {
    pub conn: Mutex<Conn>,
}

fn db_err(error: mysql_async::Error) -> String {
    match error {
        mysql_async::Error::Server(server) => {
            format!("MySQL 错误 {}: {}", server.code, server.message)
        }
        other => format!("MySQL 错误: {other}"),
    }
}

async fn timed<T>(
    future: impl Future<Output = Result<T, mysql_async::Error>>,
) -> Result<T, String> {
    match tokio::time::timeout(QUERY_TIMEOUT, future).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(db_err(error)),
        Err(_) => Err("MySQL 操作超时".to_string()),
    }
}

async fn open(config: &DbConfig) -> Result<Conn, String> {
    let opts = OptsBuilder::default()
        .ip_or_hostname(config.host.clone())
        .tcp_port(config.port)
        .user(Some(config.username.clone()))
        .pass(config.password.clone())
        .prefer_socket(false)
        .stmt_cache_size(Some(0));

    match tokio::time::timeout(CONNECT_TIMEOUT, Conn::new(opts)).await {
        Ok(Ok(conn)) => Ok(conn),
        Ok(Err(error)) => Err(db_err(error)),
        Err(_) => Err("连接 MySQL 超时".to_string()),
    }
}

async fn server_version(conn: &mut Conn) -> Result<String, String> {
    let version: Option<String> = timed(conn.query_first("SELECT VERSION()")).await?;
    Ok(version.unwrap_or_default())
}

fn quote_ident(value: &str) -> String {
    format!("`{}`", value.replace('`', "``"))
}

fn qualified(database: &str, table: &str) -> String {
    format!("{}.{}", quote_ident(database), quote_ident(table))
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn filter_clause(filters: &[DbFilter], conjunction: Option<&str>) -> (String, Vec<Value>) {
    let mut parts = Vec::new();
    let mut params = Vec::new();
    for filter in filters {
        let column = filter.column.trim();
        if column.is_empty() {
            continue;
        }
        let quoted = quote_ident(column);
        let value = filter.value.clone().unwrap_or_default();
        let text = || Value::Bytes(value.clone().into_bytes());
        match filter.operator.as_str() {
            "eq" => {
                parts.push(format!("{quoted} = ?"));
                params.push(text());
            }
            "neq" => {
                parts.push(format!("{quoted} <> ?"));
                params.push(text());
            }
            "contains" => {
                parts.push(format!("{quoted} LIKE ? ESCAPE '\\\\'"));
                params.push(Value::Bytes(
                    format!("%{}%", escape_like(&value)).into_bytes(),
                ));
            }
            "startsWith" => {
                parts.push(format!("{quoted} LIKE ? ESCAPE '\\\\'"));
                params.push(Value::Bytes(
                    format!("{}%", escape_like(&value)).into_bytes(),
                ));
            }
            "endsWith" => {
                parts.push(format!("{quoted} LIKE ? ESCAPE '\\\\'"));
                params.push(Value::Bytes(
                    format!("%{}", escape_like(&value)).into_bytes(),
                ));
            }
            "gt" => {
                parts.push(format!("{quoted} > ?"));
                params.push(text());
            }
            "gte" => {
                parts.push(format!("{quoted} >= ?"));
                params.push(text());
            }
            "lt" => {
                parts.push(format!("{quoted} < ?"));
                params.push(text());
            }
            "lte" => {
                parts.push(format!("{quoted} <= ?"));
                params.push(text());
            }
            "isNull" => parts.push(format!("{quoted} IS NULL")),
            "isNotNull" => parts.push(format!("{quoted} IS NOT NULL")),
            _ => {}
        }
    }
    if parts.is_empty() {
        return (String::new(), params);
    }
    let joiner = if conjunction
        .map(|value| value.eq_ignore_ascii_case("or"))
        .unwrap_or(false)
    {
        " OR "
    } else {
        " AND "
    };
    (format!(" WHERE {}", parts.join(joiner)), params)
}

fn where_for_keys(keys: &[DbKey]) -> (String, Vec<Value>) {
    let mut parts = Vec::new();
    let mut params = Vec::new();
    for key in keys {
        let column = key.column.trim();
        if column.is_empty() {
            continue;
        }
        parts.push(format!("{} = ?", quote_ident(column)));
        params.push(match &key.value {
            Some(value) => Value::Bytes(value.clone().into_bytes()),
            None => Value::NULL,
        });
    }
    (parts.join(" AND "), params)
}

fn insert_row_sql(target: &str, values: &[DbKey]) -> (String, Vec<Value>) {
    let mut columns = Vec::new();
    let mut placeholders = Vec::new();
    let mut params = Vec::new();
    for value in values {
        let column = value.column.trim();
        if column.is_empty() {
            continue;
        }
        columns.push(quote_ident(column));
        placeholders.push("?");
        params.push(match &value.value {
            Some(value) => Value::Bytes(value.clone().into_bytes()),
            None => Value::NULL,
        });
    }
    let sql = if columns.is_empty() {
        format!("INSERT INTO {target} () VALUES ()")
    } else {
        format!(
            "INSERT INTO {target} ({}) VALUES ({})",
            columns.join(", "),
            placeholders.join(", ")
        )
    };
    (sql, params)
}

fn table_data_sql(
    target: &str,
    where_sql: &str,
    limit: u32,
    offset: u32,
    order_by: Option<&str>,
    order_dir: Option<&str>,
) -> String {
    let mut sql = format!("SELECT * FROM {target}{where_sql}");
    if let Some(column) = order_by.map(str::trim).filter(|column| !column.is_empty()) {
        let direction = if order_dir
            .map(|value| value.eq_ignore_ascii_case("desc"))
            .unwrap_or(false)
        {
            "DESC"
        } else {
            "ASC"
        };
        sql.push_str(&format!(" ORDER BY {} {}", quote_ident(column), direction));
    }
    sql.push_str(&format!(" LIMIT {limit} OFFSET {offset}"));
    sql
}

fn value_text(value: Value) -> Option<String> {
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

async fn run_query(
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

async fn run_query_params(
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

async fn primary_key_columns(conn: &mut Conn, database: &str, table: &str) -> Vec<String> {
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

async fn exec_affected(conn: &mut Conn, sql: String, params: Params) -> Result<u64, String> {
    let result = timed(conn.exec_iter(sql, params)).await?;
    let affected = result.affected_rows();
    timed(result.drop_result()).await?;
    Ok(affected)
}

async fn connection<'a>(state: &'a AppState, id: &str) -> Result<Arc<DbConnection>, String> {
    state
        .db
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or_else(|| "数据库连接不存在或已断开".to_string())
}

/* ------------------------------ configs ------------------------------- */

#[tauri::command]
pub fn db_config_list(state: State<AppState>) -> Vec<DbConfig> {
    state.store.db_list()
}

#[tauri::command]
pub fn db_config_upsert(state: State<AppState>, config: DbConfig) -> Result<Vec<DbConfig>, String> {
    state
        .store
        .db_upsert(config)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn db_config_delete(state: State<AppState>, id: String) -> Result<Vec<DbConfig>, String> {
    state
        .store
        .db_delete(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn db_test(config: DbConfig) -> Result<DbConnectInfo, String> {
    let mut conn = open(&config).await?;
    let version = server_version(&mut conn).await?;
    let mut database = None;
    if let Some(name) = config
        .database
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        timed(conn.query_drop(format!("USE {}", quote_ident(name)))).await?;
        database = Some(name.to_string());
    }
    let _ = conn.disconnect().await;
    Ok(DbConnectInfo {
        server: config.target(),
        version,
        database,
    })
}

#[tauri::command]
pub async fn db_connect(
    state: State<'_, AppState>,
    config: DbConfig,
) -> Result<DbConnectInfo, String> {
    if !config.kind.is_empty() && config.kind != "mysql" {
        return Err("当前只支持 MySQL".to_string());
    }
    let mut conn = open(&config).await?;
    let version = server_version(&mut conn).await?;
    let mut database = None;
    if let Some(name) = config
        .database
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        timed(conn.query_drop(format!("USE {}", quote_ident(name)))).await?;
        database = Some(name.to_string());
    }

    let id = config.id.clone();
    let connection = Arc::new(DbConnection {
        conn: Mutex::new(conn),
    });
    state.db.lock().await.insert(id.clone(), connection);
    let _ = state.store.db_touch(&id);

    Ok(DbConnectInfo {
        server: config.target(),
        version,
        database,
    })
}

#[tauri::command]
pub async fn db_disconnect(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.lock().await.remove(&id);
    Ok(())
}

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

fn validate_ddl(statement: &str) -> Result<(), String> {
    let value = statement.trim();
    if value.is_empty() {
        return Err("DDL 语句不能为空".to_string());
    }
    let upper = value.to_ascii_uppercase();
    let allowed = [
        "ALTER TABLE ",
        "CREATE TABLE ",
        "DROP TABLE ",
        "TRUNCATE TABLE ",
        "RENAME TABLE ",
        "CREATE INDEX ",
        "DROP INDEX ",
        "CREATE UNIQUE INDEX ",
    ];
    if !allowed.iter().any(|prefix| upper.starts_with(prefix)) {
        return Err("只允许执行建表/改表/索引相关的 DDL 语句".to_string());
    }
    if value.contains(';') || value.contains("--") || value.contains("/*") || value.contains("*/") {
        return Err("DDL 语句不能包含多条语句或注释".to_string());
    }
    Ok(())
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
    fn quotes_identifiers() {
        assert_eq!(quote_ident("user"), "`user`");
        assert_eq!(quote_ident("a`b"), "`a``b`");
        assert_eq!(qualified("db", "t"), "`db`.`t`");
    }

    #[test]
    fn builds_table_sql_with_sort() {
        assert_eq!(
            table_data_sql("`db`.`t`", "", 100, 0, None, None),
            "SELECT * FROM `db`.`t` LIMIT 100 OFFSET 0"
        );
        assert_eq!(
            table_data_sql(
                "`db`.`t`",
                " WHERE `status` = ?",
                50,
                100,
                Some("name"),
                Some("asc")
            ),
            "SELECT * FROM `db`.`t` WHERE `status` = ? ORDER BY `name` ASC LIMIT 50 OFFSET 100"
        );
        assert_eq!(
            table_data_sql("`db`.`t`", "", 50, 0, Some("a`b"), Some("DESC")),
            "SELECT * FROM `db`.`t` ORDER BY `a``b` DESC LIMIT 50 OFFSET 0"
        );
        assert_eq!(
            table_data_sql("`db`.`t`", "", 50, 0, Some("created_at"), Some("oops")),
            "SELECT * FROM `db`.`t` ORDER BY `created_at` ASC LIMIT 50 OFFSET 0"
        );
    }

    #[test]
    fn validates_ddl() {
        assert!(validate_ddl("ALTER TABLE `db`.`t` ADD COLUMN `c` INT").is_ok());
        assert!(validate_ddl("alter table `db`.`t` drop column `c`").is_ok());
        assert!(validate_ddl("DROP TABLE `db`.`t`").is_ok());
        assert!(validate_ddl("CREATE INDEX `idx` ON `db`.`t` (`c`)").is_ok());
        assert!(validate_ddl("SELECT * FROM `db`.`t`").is_err());
        assert!(
            validate_ddl("ALTER TABLE `db`.`t` ADD COLUMN `c` INT; DROP TABLE `db`.`t`").is_err()
        );
        assert!(validate_ddl("ALTER TABLE `db`.`t` ADD COLUMN `c` INT -- comment").is_err());
    }

    #[test]
    fn builds_insert_sql() {
        let (sql, params) = insert_row_sql(
            "`db`.`t`",
            &[
                DbKey {
                    column: "name".into(),
                    value: Some("alice".into()),
                },
                DbKey {
                    column: "age".into(),
                    value: Some("20".into()),
                },
            ],
        );
        assert_eq!(sql, "INSERT INTO `db`.`t` (`name`, `age`) VALUES (?, ?)");
        assert_eq!(params.len(), 2);

        let (sql, params) = insert_row_sql("`db`.`t`", &[]);
        assert_eq!(sql, "INSERT INTO `db`.`t` () VALUES ()");
        assert!(params.is_empty());
    }

    #[test]
    fn builds_filters() {
        let filters = vec![
            DbFilter {
                column: "status".into(),
                operator: "eq".into(),
                value: Some("0".into()),
            },
            DbFilter {
                column: "name".into(),
                operator: "contains".into(),
                value: Some("a%b".into()),
            },
            DbFilter {
                column: "deleted_at".into(),
                operator: "isNull".into(),
                value: None,
            },
        ];
        let (sql, params) = filter_clause(&filters, Some("or"));
        assert_eq!(
            sql,
            " WHERE `status` = ? OR `name` LIKE ? ESCAPE '\\\\' OR `deleted_at` IS NULL"
        );
        assert_eq!(params.len(), 2);
    }

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
