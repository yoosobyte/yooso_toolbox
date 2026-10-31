import type { DbQueryResult } from "./api";
import { escapeSqlString, qualified, quoteIdent } from "./ddl";

/** 生成单表 SQL 导出文本（结构 + 数据），供右键菜单导出使用 */
export function buildTableDumpSql(
  database: string,
  table: string,
  ddl: string,
  result: DbQueryResult,
): string {
  const lines = [
    "-- 悦盒 SQL export",
    `-- ${qualified(database, table)}`,
    "SET NAMES utf8mb4;",
    "SET FOREIGN_KEY_CHECKS=0;",
    "",
    `${ddl.trim().replace(/;?$/, "")};`,
  ];
  if (result.rows.length > 0) {
    const columns = result.columns.map((column) => quoteIdent(column.name)).join(", ");
    const values = result.rows.map(
      (row) =>
        `(${row
          .map((value) =>
            value === null ? "NULL" : `'${escapeSqlString(value)}'`,
          )
          .join(", ")})`,
    );
    lines.push(
      "",
      `INSERT INTO ${qualified(database, table)} (${columns}) VALUES`,
      `${values.join(",\n")};`,
    );
  }
  lines.push("", "SET FOREIGN_KEY_CHECKS=1;");
  return lines.join("\n");
}

/** 导出文件名：database.table.sql，非法文件名字符替换为下划线 */
export function dumpFileName(database: string, table: string): string {
  return `${database}.${table}.sql`.replace(/[\\/:*?"<>|]/g, "_");
}
