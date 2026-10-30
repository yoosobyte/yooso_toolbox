export type ModuleKey =
  | "ssh"
  | "text"
  | "note"
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
  "db",
  "redis",
  "api",
  "ssh",
  "text",
  "note",
  "translate",
  "qrcode",
  "browser",
  "ai",
  "tools",
];
