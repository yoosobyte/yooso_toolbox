import type { TFunction } from "../../i18n";

/** 键列表展示方式 */
export type RedisKeyView = "tree" | "list";

/** 字符串值的展示方式 */
export type RedisStringMode = "tree" | "text";

/** 键列表展示方式的本地存储 key */
export const KEY_VIEW_STORAGE = "yooso.redis.keyView";

/** 读取上次的键列表展示方式；localStorage 不可用时回退到树形 */
export function readStoredKeyView(): RedisKeyView {
  try {
    return localStorage.getItem(KEY_VIEW_STORAGE) === "list" ? "list" : "tree";
  } catch {
    return "tree";
  }
}

/** 空模式按 * 处理；没有通配符时按包含匹配 */
export function normalizePattern(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "*";
  if (trimmed.includes("*") || trimmed.includes("?")) return trimmed;
  return `*${trimmed}*`;
}

/** 新建键弹窗的 TTL 选项 → 秒数（null 表示不过期） */
export function ttlPresetSeconds(preset: string, customTtl: number | null): number | null {
  if (preset === "custom") return customTtl && customTtl > 0 ? customTtl : null;
  if (preset === "never") return null;
  return Number(preset);
}

/** 详情头 / 键列表悬浮提示里的完整 TTL 文案 */
export function formatTtlLabel(ttl: number, t: TFunction): string {
  if (ttl === -1) return t("redis.ttlNoExpire");
  if (ttl === -2) return t("redis.ttlExpired");
  return t("redis.ttlSeconds", { count: ttl });
}
