export interface DbQueryDef {
  id: string;
  connectionId: string;
  database: string;
  name: string;
  sql: string;
  createdAt: number;
}

const STORAGE_KEY = "yooso.toolbox.db.queries.v1";

export function loadQueries(): DbQueryDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is DbQueryDef => {
      if (!item || typeof item !== "object") return false;
      const query = item as Partial<DbQueryDef>;
      return (
        typeof query.id === "string" &&
        typeof query.connectionId === "string" &&
        typeof query.database === "string" &&
        typeof query.name === "string" &&
        typeof query.sql === "string"
      );
    });
  } catch {
    return [];
  }
}

export function saveQueries(queries: DbQueryDef[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
  } catch {
    // localStorage 不可用时仅保留当前会话内状态。
  }
}

export function createQueryDef(
  connectionId: string,
  database: string,
  name: string,
): DbQueryDef {
  return {
    id: crypto.randomUUID(),
    connectionId,
    database,
    name: name.trim(),
    sql: "",
    createdAt: Date.now(),
  };
}
