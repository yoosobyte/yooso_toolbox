import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../../save";

/** 按站点 origin 缓存，避免重复请求 */
const cache = new Map<string, Promise<string | null>>();

/**
 * 通过 Rust 侧抓取网页 favicon（解析 <link rel="icon">，带浏览器 UA），
 * 返回 data URL；失败返回 null。
 */
export function loadFavicon(url: string): Promise<string | null> {
  if (!inTauri()) return Promise.resolve(null);
  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch {
    return Promise.resolve(null);
  }
  const cached = cache.get(origin);
  if (cached) return cached;
  const task = invoke<string | null>("fetch_favicon", { url })
    .then((data) => data ?? null)
    .catch(() => null);
  cache.set(origin, task);
  return task;
}
