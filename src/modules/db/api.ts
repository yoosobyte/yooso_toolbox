import { invoke } from "@tauri-apps/api/core";

export interface DbConfig {
  id: string;
  name: string;
  kind: string;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  savePassword: boolean;
  database?: string | null;
  lastUsedAt?: number | null;
  createdAt?: number | null;
}

export interface DbConnectInfo {
  server: string;
  version: string;
  database?: string | null;
}

export interface DbTableInfo {
  name: string;
  kind: string;
}

export interface DbColumnInfo {
  name: string;
  typeName: string;
}

export interface DbFilter {
  column: string;
  operator: string;
  value?: string | null;
  conjunction?: "and" | "or";
}

export interface DbKey {
  column: string;
  value: string | null;
}

export interface DbQueryResult {
  columns: DbColumnInfo[];
  rows: (string | null)[][];
  affectedRows: number;
  lastInsertId?: number | null;
  elapsedMs: number;
  message?: string | null;
  total?: number | null;
  primaryKey: string[];
}

export const dbConfigList = () => invoke<DbConfig[]>("db_config_list");

export const dbConfigUpsert = (config: DbConfig) =>
  invoke<DbConfig[]>("db_config_upsert", { config });

export const dbConfigDelete = (id: string) =>
  invoke<DbConfig[]>("db_config_delete", { id });

export const dbTest = (config: DbConfig) => invoke<DbConnectInfo>("db_test", { config });

export const dbConnect = (config: DbConfig) =>
  invoke<DbConnectInfo>("db_connect", { config });

export const dbDisconnect = (id: string) => invoke<void>("db_disconnect", { id });

export const dbDatabases = (id: string) => invoke<string[]>("db_databases", { id });

export const dbTables = (id: string, database: string) =>
  invoke<DbTableInfo[]>("db_tables", { id, database });

export const dbCloneTable = (
  id: string,
  database: string,
  table: string,
  newTable: string,
  withData: boolean,
) => invoke<number>("db_clone_table", { id, database, table, newTable, withData });

export const dbDatabaseCollation = (id: string, database: string) =>
  invoke<string | null>("db_database_collation", { id, database });

export interface DbTableOptions {
  name: string;
  comment: string;
  engine: string;
  autoIncrement: number | null;
}

export const dbTableOptions = (id: string, database: string, table: string) =>
  invoke<DbTableOptions>("db_table_options", { id, database, table });

export const dbTableDdl = (id: string, database: string, table: string) =>
  invoke<string>("db_table_ddl", { id, database, table });

export const dbTableIndexes = (id: string, database: string, table: string) =>
  invoke<DbQueryResult>("db_table_indexes", { id, database, table });

export const dbTableColumns = (id: string, database: string, table: string) =>
  invoke<DbQueryResult>("db_table_columns", { id, database, table });

export const dbTableData = (
  id: string,
  database: string,
  table: string,
  limit: number,
  offset: number,
  orderBy?: string | null,
  orderDir?: "asc" | "desc" | null,
  filters?: DbFilter[] | null,
  conjunction?: "and" | "or" | null,
) =>
  invoke<DbQueryResult>("db_table_data", {
    id,
    database,
    table,
    limit,
    offset,
    orderBy: orderBy ?? null,
    orderDir: orderDir ?? null,
    filters: filters ?? null,
    conjunction: conjunction ?? null,
  });

export const dbUpdateCell = (
  id: string,
  database: string,
  table: string,
  column: string,
  value: string | null,
  keys: DbKey[],
) => invoke<number>("db_update_cell", { id, database, table, column, value, keys });

export const dbDeleteRows = (
  id: string,
  database: string,
  table: string,
  rows: DbKey[][],
) => invoke<number>("db_delete_rows", { id, database, table, rows });

export const dbInsertRow = (
  id: string,
  database: string,
  table: string,
  values: DbKey[],
) => invoke<number>("db_insert_row", { id, database, table, values });

export const dbExecDdl = (id: string, statement: string) =>
  invoke<number>("db_exec_ddl", { id, statement });

export const dbQuery = (id: string, database: string | null, sql: string) =>
  invoke<DbQueryResult>("db_query", { id, database, sql });
