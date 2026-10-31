import { useEffect, useState } from "react";

import { en } from "./en";
import { zh } from "./zh";

/**
 * 极简 i18n：扁平 key + 变量插值。
 * 所有界面文案集中在下面的字典里，新增文案时两边都要加。
 */

export type Lang = "zh" | "en";
export type LangSetting = "system" | Lang;

const dicts: Record<Lang, Record<string, string>> = { zh, en };

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

/** 把系统语言归一到 zh / en */
export function systemLang(): Lang {
  const raw = (navigator.language || "zh").toLowerCase();
  return raw.startsWith("zh") ? "zh" : "en";
}

export function resolveLang(setting: LangSetting): Lang {
  return setting === "system" ? systemLang() : setting;
}

/** 不依赖 React 的翻译函数（给 store / 事件回调用） */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const template = dicts[lang][key] ?? dicts.zh[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] === undefined ? `{${name}}` : String(vars[name]),
  );
}

/** 组件里用：语言变化时自动重渲染 */
export function useT(lang: Lang): TFunction {
  const [, force] = useState(0);
  // lang 变化 → 组件重渲染即可，这里保持引用稳定
  useEffect(() => {
    force((value) => value + 1);
  }, [lang]);
  return (key, vars) => translate(lang, key, vars);
}
