import type { DbQueryDef } from "./queries";

/** 表页签支持的内嵌视图 */
export type DbTabView = "data" | "structure" | "index" | "settings" | "ddl";

export interface TableTab {
  key: string;
  database: string;
  table: string;
  view: DbTabView;
}

/** 表格操作的目标（右键菜单项去掉坐标后的部分） */
export interface TableTarget {
  database: string;
  table: string;
}

export interface TableMenuState extends TableTarget {
  x: number;
  y: number;
}

export interface DatabaseMenuState {
  x: number;
  y: number;
  database: string;
}

export interface QueryMenuState {
  x: number;
  y: number;
  query: DbQueryDef;
}

export interface TabMenuState {
  x: number;
  y: number;
  key: string;
}

/** 当前活动的连接 id；异步请求返回时用它判断连接是否已经切换 */
export interface ConnectionIdRef {
  current: string | null;
}

export const SYSTEM_DATABASES = new Set([
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
]);

export const MIN_SIDE_WIDTH = 200;
export const MAX_SIDE_WIDTH = 560;

export function pickDatabase(databases: string[], preferred: string | null): string | null {
  if (preferred && databases.includes(preferred)) return preferred;
  return (
    databases.find((name) => !SYSTEM_DATABASES.has(name.toLowerCase())) ??
    databases[0] ??
    null
  );
}

/** 表格页签的 key：database.table */
export function tableKey(database: string, table: string): string {
  return `${database}.${table}`;
}
