/** 资源占用百分比；总量为 0 时返回 0 */
export function percent(used: number, total: number): number {
  return total > 0 ? Math.min(100, (used / total) * 100) : 0;
}

/** 进度条 / 数值的颜色等级：>=85 高，>=65 中 */
export function levelClass(value: number): string {
  return value >= 85 ? "high" : value >= 65 ? "mid" : "";
}

/** 进度条填充宽度：0 就完全不画，非 0 至少留 1.5% 以免看不见 */
export function fillWidth(value: number): string {
  return `${value <= 0 ? 0 : Math.max(1.5, Math.min(100, value))}%`;
}

/** 网络速率（字节/秒）→ 人类可读 */
export function formatRate(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)}${units[index]}`;
}

/** 容量（字节）→ 人类可读 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)}${units[index]}`;
}
