export type NoteFormat = "md" | "txt";

export interface Note {
  id: string;
  title: string;
  content: string;
  format: NoteFormat;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "yooso.notes.v1";

function normalizeNote(raw: unknown): Note | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id) return null;
  const now = Date.now();
  return {
    id: value.id,
    title: typeof value.title === "string" ? value.title : "",
    content: typeof value.content === "string" ? value.content : "",
    format: value.format === "txt" ? "txt" : "md",
    createdAt: typeof value.createdAt === "number" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : now,
  };
}

/** 读取本机保存的笔记，按更新时间倒序 */
export function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeNote)
      .filter((note): note is Note => note !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveNotes(notes: Note[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch {
    /* 存储空间不可用时忽略 */
  }
}

export function createNote(format: NoteFormat = "md"): Note {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "",
    content: "",
    format,
    createdAt: now,
    updatedAt: now,
  };
}
