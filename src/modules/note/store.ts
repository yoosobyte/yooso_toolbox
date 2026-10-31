import type { NoteFont } from "./fonts";
import { loadStored, migrateStored, saveStored } from "../../storage";

export type NoteFormat = "md" | "txt" | "json";

export interface Note {
  id: string;
  title: string;
  content: string;
  format: NoteFormat;
  /** 每篇笔记独立的字号（纯文本生效） */
  fontSize?: number;
  /** 每篇笔记独立的字体 */
  font?: NoteFont;
  createdAt: number;
  updatedAt: number;
}

const SECRET_KEY = "notes";
const LEGACY_KEY = "yooso.notes.v1";
const NOTE_FONT_KEYS: Record<string, true> = {
  system: true,
  sans: true,
  serif: true,
  mono: true,
  kai: true,
};

function normalizeNote(raw: unknown): Note | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id) return null;
  const now = Date.now();
  return {
    id: value.id,
    title: typeof value.title === "string" ? value.title : "",
    content: typeof value.content === "string" ? value.content : "",
    format:
      value.format === "txt"
        ? "txt"
        : value.format === "json"
          ? "json"
          : "md",
    fontSize:
      typeof value.fontSize === "number" && value.fontSize >= 10
        ? value.fontSize
        : undefined,
    font:
      typeof value.font === "string" && value.font in NOTE_FONT_KEYS
        ? (value.font as NoteFont)
        : undefined,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : now,
  };
}

/** 读取本机保存的笔记，按更新时间倒序（加密凭据库） */
export async function loadNotes(): Promise<Note[]> {
  await migrateStored(LEGACY_KEY, SECRET_KEY);
  const raw = await loadStored(SECRET_KEY);
  if (!raw) return [];
  try {
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

export async function saveNotes(notes: Note[]): Promise<void> {
  await saveStored(SECRET_KEY, JSON.stringify(notes));
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
