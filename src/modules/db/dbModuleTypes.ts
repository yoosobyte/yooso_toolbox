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
  /** 该页签所属数据库，用于「新建查询」 */
  database: string;
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

/** 只有显式指定（连接配置默认库 / 新建库 / 刷新当前库）时才自动选中，
 *  打开连接不再默认展开第一个库 */
export function pickDatabase(databases: string[], preferred: string | null): string | null {
  return preferred && databases.includes(preferred) ? preferred : null;
}

/** 表格页签的 key：database.table */
export function tableKey(database: string, table: string): string {
  return `${database}.${table}`;
}
