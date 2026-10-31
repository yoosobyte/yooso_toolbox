import { loadStored, migrateStored, saveStored } from "../../storage";

export interface DbQueryDef {
  id: string;
  connectionId: string;
  database: string;
  name: string;
  sql: string;
  createdAt: number;
}

const SECRET_KEY = "db.queries";
const LEGACY_KEY = "yooso.toolbox.db.queries.v1";

export async function loadQueries(): Promise<DbQueryDef[]> {
  await migrateStored(LEGACY_KEY, SECRET_KEY);
  const raw = await loadStored(SECRET_KEY);
  try {
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

export async function saveQueries(queries: DbQueryDef[]): Promise<void> {
  await saveStored(SECRET_KEY, JSON.stringify(queries));
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
