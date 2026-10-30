/** MySQL 连接可选配色（顺序即配色面板顺序） */
export const DB_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#a855f7",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#64748b",
] as const;

export const DEFAULT_DB_COLOR: string = DB_COLORS[0];

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * 连接的展示配色。
 * 没有配置或存档里的值不合法时回退到默认色，避免 color-mix 失效导致整块背景丢色。
 */
export function connectionColor(color?: string | null): string {
  return color && HEX_COLOR.test(color) ? color : DEFAULT_DB_COLOR;
}
