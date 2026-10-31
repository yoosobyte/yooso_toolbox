import dayjs from "dayjs";

/** 把 Tauri invoke 抛出的错误转成可读文案 */
export function errText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      /* ignore */
    }
  }
  return String(error);
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "-";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[index]}`;
}

export function formatTime(ts?: number): string {
  if (!ts) return "-";
  return dayjs(ts * 1000).format("YYYY-MM-DD HH:mm");
}

/** 兼容 Windows 反斜杠与 POSIX 斜杠 */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

export function joinRemote(dir: string, name: string): string {
  if (dir.endsWith("/")) return `${dir}${name}`;
  return `${dir}/${name}`;
}

export function parentOfRemote(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

/** 会话头像用的主题色 */
export const SESSION_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#a855f7",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];

/* ------------------------------------------------------------------ */
/* 输入法回车保护                                                      */
/* ------------------------------------------------------------------ */

/** 全局的输入法组词状态：一次注册，所有输入框共用 */
let imeComposing = false;
if (typeof document !== "undefined") {
  document.addEventListener(
    "compositionstart",
    () => {
      imeComposing = true;
    },
    true,
  );
  document.addEventListener(
    "compositionend",
    () => {
      imeComposing = false;
    },
    true,
  );
}

/**
 * 回车是否发生在输入法组词过程中。
 * 组词时按回车只负责把候选词上屏，不应该触发提交 / 发送 / 跳转；
 * 再按一次回车（组词已结束）才执行动作。
 */
export function isImeEnter(event?: { nativeEvent?: KeyboardEvent }): boolean {
  const native = event?.nativeEvent;
  return (
    imeComposing ||
    Boolean(native?.isComposing) ||
    native?.keyCode === 229
  );
}
