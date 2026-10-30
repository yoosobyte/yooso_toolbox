import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";

/**
 * 统一保存前端生成的文件。
 * - Tauri 里：弹系统保存框 → 调 Rust 命令写盘
 * - 浏览器里（纯前端调试）：退化成 <a download>
 */

export interface SaveFilter {
  name: string;
  extensions: string[];
}

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function browserDownload(href: string, filename: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function askPath(defaultPath: string, filters: SaveFilter[]): Promise<string | null> {
  return saveDialog({
    defaultPath,
    filters,
  });
}

/** 保存 base64 dataURL（PNG 等），返回最终路径；取消返回 null */
export async function saveDataUrl(
  defaultPath: string,
  dataUrl: string,
  filters: SaveFilter[],
): Promise<string | null> {
  if (!inTauri()) {
    browserDownload(dataUrl, defaultPath);
    return defaultPath;
  }
  const path = await askPath(defaultPath, filters);
  if (!path) return null;
  const comma = dataUrl.indexOf(",");
  const dataBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  await invoke("save_binary_file", { path, dataBase64 });
  return path;
}

/** 保存纯文本（SVG 等），返回最终路径；取消返回 null */
export async function saveText(
  defaultPath: string,
  text: string,
  filters: SaveFilter[],
  mime = "image/svg+xml",
): Promise<string | null> {
  if (!inTauri()) {
    const blob = new Blob([text], { type: mime });
    const href = URL.createObjectURL(blob);
    try {
      browserDownload(href, defaultPath);
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(href), 1500);
    }
    return defaultPath;
  }
  const path = await askPath(defaultPath, filters);
  if (!path) return null;
  await invoke("save_text_file", { path, text });
  return path;
}
