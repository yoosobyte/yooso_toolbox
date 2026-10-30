const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * 列表里的短 TTL。最多展示两个单位，保持单行：
 * 45s / 5m 30s / 2h 15m / 3d 4h / 2M 5d / 1y 2M
 *
 * 月份按 30 天、年份按 365 天估算；精确秒数仍可通过 title 查看。
 */
export function formatTtlShort(ttl: number): string {
  if (ttl === -1) return "∞";
  if (ttl === -2) return "—";
  if (ttl <= 0) return "0s";

  const units = [
    { label: "y", seconds: YEAR },
    { label: "M", seconds: MONTH },
    { label: "d", seconds: DAY },
    { label: "h", seconds: HOUR },
    { label: "m", seconds: MINUTE },
    { label: "s", seconds: 1 },
  ];

  const parts: string[] = [];
  let remaining = ttl;
  for (const unit of units) {
    if (remaining < unit.seconds) continue;
    const count = Math.floor(remaining / unit.seconds);
    parts.push(`${count}${unit.label}`);
    remaining -= count * unit.seconds;
    if (parts.length === 2) break;
  }

  return parts.length > 0 ? parts.join(" ") : `${ttl}s`;
}
