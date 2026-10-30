import { invoke } from "@tauri-apps/api/core";

export type TranslateLine = "cn" | "intl";

export interface TranslateResult {
  text: string;
  /** 必应识别出的源语言，例如 zh-Hans / en */
  detected?: string;
  target: string;
  /** 实际使用的线路 */
  line: TranslateLine;
}

/** 必应翻译直连（Rust 侧完成取 token + 请求，不加载网页） */
export const translateText = (
  text: string,
  from: string,
  to: string,
  line: TranslateLine,
) => invoke<TranslateResult>("translate_text", { text, from, to, line });
