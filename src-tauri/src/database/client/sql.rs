use mysql_async::Value;

use crate::core::models::{DbFilter, DbKey};

pub(super) fn quote_ident(value: &str) -> String {
    format!("`{}`", value.replace('`', "``"))
}

pub(super) fn qualified(database: &str, table: &str) -> String {
    format!("{}.{}", quote_ident(database), quote_ident(table))
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

pub(super) fn filter_clause(filters: &[DbFilter], conjunction: Option<&str>) -> (String, Vec<Value>) {
    let mut sql = String::new();
    let mut params = Vec::new();
    // 链接符在选择器行首（第二行起才有），表示当前条件与上一个条件之间的关系，
    // 第一行没有上一个条件，它的 conjunction 会被忽略。
    for filter in filters {
        let column = filter.column.trim();
        if column.is_empty() {
            continue;
        }
        let quoted = quote_ident(column);
        let value = filter.value.clone().unwrap_or_default();
        let (part, values): (String, Vec<Value>) = match filter.operator.as_str() {
            "eq" => (
                format!("{quoted} = ?"),
                vec![Value::Bytes(value.into_bytes())],
            ),
            "neq" => (
                format!("{quoted} <> ?"),
                vec![Value::Bytes(value.into_bytes())],
            ),
            "contains" => (
                format!("{quoted} LIKE ? ESCAPE '\\\\'"),
                vec![Value::Bytes(
                    format!("%{}%", escape_like(&value)).into_bytes(),
                )],
            ),
            "notContains" => (
                format!("{quoted} NOT LIKE ? ESCAPE '\\\\'"),
                vec![Value::Bytes(
                    format!("%{}%", escape_like(&value)).into_bytes(),
                )],
            ),
            "startsWith" => (
                format!("{quoted} LIKE ? ESCAPE '\\\\'"),
                vec![Value::Bytes(
                    format!("{}%", escape_like(&value)).into_bytes(),
                )],
            ),
            "endsWith" => (
                format!("{quoted} LIKE ? ESCAPE '\\\\'"),
                vec![Value::Bytes(
                    format!("%{}", escape_like(&value)).into_bytes(),
                )],
            ),
            "gt" => (
                format!("{quoted} > ?"),
                vec![Value::Bytes(value.into_bytes())],
            ),
            "gte" => (
                format!("{quoted} >= ?"),
                vec![Value::Bytes(value.into_bytes())],
            ),
            "lt" => (
                format!("{quoted} < ?"),
                vec![Value::Bytes(value.into_bytes())],
            ),
            "lte" => (
                format!("{quoted} <= ?"),
                vec![Value::Bytes(value.into_bytes())],
            ),
            "isNull" => (format!("{quoted} IS NULL"), Vec::new()),
            "isNotNull" => (format!("{quoted} IS NOT NULL"), Vec::new()),
            "in" | "notIn" => {
                let items: Vec<Value> = value
                    .split(',')
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
                    .map(|item| Value::Bytes(item.as_bytes().to_vec()))
                    .collect();
                if items.is_empty() {
                    continue;
                }
                let placeholders = vec!["?"; items.len()].join(", ");
                let operator = if filter.operator == "in" {
                    "IN"
                } else {
                    "NOT IN"
                };
                (format!("{quoted} {operator} ({placeholders})"), items)
            }
            _ => continue,
        };
        if sql.is_empty() {
            sql = part;
        } else {
            let joiner = filter
                .conjunction
                .as_deref()
                .or(conjunction)
                .unwrap_or("and");
            let joiner = if joiner.eq_ignore_ascii_case("or") {
                " OR "
            } else {
                " AND "
            };
            sql = format!("({sql}){joiner}{part}");
        }
        params.extend(values);
    }
    if sql.is_empty() {
        (String::new(), params)
    } else {
        (format!(" WHERE {sql}"), params)
    }
}

pub(super) fn where_for_keys(keys: &[DbKey]) -> (String, Vec<Value>) {
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

pub(super) fn insert_row_sql(target: &str, values: &[DbKey]) -> (String, Vec<Value>) {
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

pub(super) fn table_data_sql(
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

pub(super) fn validate_ddl(statement: &str) -> Result<(), String> {
    // 允许语句末尾带分号（SQL 预览 / 手工输入都常见），只拒绝语句内部的分号
    let value = statement.trim().trim_end_matches(';').trim();
    if value.is_empty() {
        return Err("DDL 语句不能为空".to_string());
    }
    let upper = value.to_ascii_uppercase();
    let allowed = [
        "CREATE DATABASE ",
        "ALTER DATABASE ",
        "DROP DATABASE ",
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
        return Err("只允许执行库/表/索引相关的 DDL 语句".to_string());
    }
    if value.contains(';') || value.contains("--") || value.contains("/*") || value.contains("*/") {
        return Err("DDL 语句不能包含多条语句或注释".to_string());
    }
    Ok(())
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
                conjunction: None,
            },
            DbFilter {
                column: "name".into(),
                operator: "contains".into(),
                value: Some("a%b".into()),
                conjunction: None,
            },
            DbFilter {
                column: "deleted_at".into(),
                operator: "isNull".into(),
                value: None,
                conjunction: None,
            },
        ];
        let (sql, params) = filter_clause(&filters, Some("or"));
        assert_eq!(
            sql,
            " WHERE ((`status` = ?) OR `name` LIKE ? ESCAPE '\\\\') OR `deleted_at` IS NULL"
        );
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn builds_mixed_filters_and_in() {
        let filters = vec![
            DbFilter {
                column: "status".into(),
                operator: "eq".into(),
                value: Some("1".into()),
                conjunction: None,
            },
            DbFilter {
                column: "role".into(),
                operator: "in".into(),
                value: Some("admin, manager".into()),
                conjunction: Some("or".into()),
            },
            DbFilter {
                column: "name".into(),
                operator: "notContains".into(),
                value: Some("test".into()),
                conjunction: Some("and".into()),
            },
        ];
        let (sql, params) = filter_clause(&filters, Some("and"));
        assert_eq!(
            sql,
            " WHERE ((`status` = ?) OR `role` IN (?, ?)) AND `name` NOT LIKE ? ESCAPE '\\\\'"
        );
        assert_eq!(params.len(), 4);
    }

    #[test]
    fn joins_row_with_previous_condition() {
        // 第二行行首的连接符连接它与上一行：id = 3 或 id = 2
        let filters = vec![
            DbFilter {
                column: "id".into(),
                operator: "eq".into(),
                value: Some("3".into()),
                conjunction: None,
            },
            DbFilter {
                column: "id".into(),
                operator: "eq".into(),
                value: Some("2".into()),
                conjunction: Some("or".into()),
            },
        ];
        let (sql, params) = filter_clause(&filters, Some("and"));
        assert_eq!(sql, " WHERE (`id` = ?) OR `id` = ?");
        assert_eq!(params.len(), 2);
    }
}
