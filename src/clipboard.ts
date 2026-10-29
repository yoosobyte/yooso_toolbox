import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * 统一走 Tauri 的剪贴板插件。
 * WebView2 里 `navigator.clipboard.writeText` 经常被静默拒绝（读却是好的），
 * 所以复制相关功能不要直接用浏览器 API。
 */
export const copyText = (text: string): Promise<void> => writeText(text);

export const pasteText = (): Promise<string> => readText();
