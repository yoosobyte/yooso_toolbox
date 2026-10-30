import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../../save";

/** 按 URL 缓存，避免重复抓取 */
const cache = new Map<string, Promise<string | null>>();

/** 通过 Rust 侧读取网页 <title>，失败返回 null */
export function loadPageTitle(url: string): Promise<string | null> {
  if (!inTauri()) return Promise.resolve(null);
  const cached = cache.get(url);
  if (cached) return cached;
  const task = invoke<string | null>("fetch_page_title", { url })
    .then((title) => title ?? null)
    .catch(() => null);
  cache.set(url, task);
  return task;
}
