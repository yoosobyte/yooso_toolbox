export type ModuleKey =
  | "ssh"
  | "text"
  | "note"
  | "files"
  | "qrcode"
  | "db"
  | "redis"
  | "api"
  | "translate"
  | "browser"
  | "ai"
  | "tools";

/** rail 顺序：按开发程序的使用顺序排 */
export const MODULE_ORDER: ModuleKey[] = [
  "files",
  "note",
  "db",
  "redis",
  "api",
  "ssh",
  "text",
  "translate",
  "qrcode",
  "browser",
  "ai",
  "tools",
];
