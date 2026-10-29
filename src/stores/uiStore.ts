import { create } from "zustand";
import type { Lang, LangSetting } from "../i18n";
import { resolveLang } from "../i18n";

export type ThemeSetting = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "yooso.ui";

interface Persisted {
  language: LangSetting;
  theme: ThemeSetting;
  showStatusBar: boolean;
}

function read(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      return {
        language: parsed.language ?? "system",
        theme: parsed.theme ?? "system",
        showStatusBar: parsed.showStatusBar ?? true,
      };
    }
  } catch {
    /* 忽略损坏的本地配置 */
  }
  return { language: "system", theme: "system", showStatusBar: true };
}

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function resolveTheme(setting: ThemeSetting): Theme {
  return setting === "system" ? systemTheme() : setting;
}

interface UiState {
  language: LangSetting;
  theme: ThemeSetting;
  /** 是否显示最底部的版本/阶段状态栏 */
  showStatusBar: boolean;
  /** 实际生效的语言 / 主题（跟随系统时会随系统变化） */
  lang: Lang;
  activeTheme: Theme;
  setLanguage: (value: LangSetting) => void;
  setTheme: (value: ThemeSetting) => void;
  setShowStatusBar: (value: boolean) => void;
  /** 监听系统主题变化 */
  syncSystem: () => void;
}

const initial = read();
applyTheme(resolveTheme(initial.theme));

function persist(state: { language: LangSetting; theme: ThemeSetting; showStatusBar: boolean }) {
  localStorage.setItem(KEY, JSON.stringify(state satisfies Persisted));
}

export const useUiStore = create<UiState>((set, get) => ({
  language: initial.language,
  theme: initial.theme,
  showStatusBar: initial.showStatusBar,
  lang: resolveLang(initial.language),
  activeTheme: resolveTheme(initial.theme),

  setLanguage: (value) => {
    persist({ language: value, theme: get().theme, showStatusBar: get().showStatusBar });
    set({ language: value, lang: resolveLang(value) });
  },

  setTheme: (value) => {
    persist({ language: get().language, theme: value, showStatusBar: get().showStatusBar });
    const active = resolveTheme(value);
    applyTheme(active);
    set({ theme: value, activeTheme: active });
  },

  setShowStatusBar: (value) => {
    persist({ language: get().language, theme: get().theme, showStatusBar: value });
    set({ showStatusBar: value });
  },

  syncSystem: () => {
    const { language, theme } = get();
    const active = resolveTheme(theme);
    applyTheme(active);
    set({ lang: resolveLang(language), activeTheme: active });
  },
}));

/** 在 main.tsx 里调用一次：系统主题 / 语言变化时同步 */
export function watchSystem() {
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const onChange = () => useUiStore.getState().syncSystem();
  media.addEventListener("change", onChange);
  window.addEventListener("languagechange", onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("languagechange", onChange);
  };
}
