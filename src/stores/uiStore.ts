import { create } from "zustand";
import type { Lang, LangSetting } from "../i18n";
import { MODULE_ORDER, type ModuleKey } from "../modules/keys";
import { resolveLang } from "../i18n";

export type ThemeSetting = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "yooso.ui";

interface Persisted {
  language: LangSetting;
  theme: ThemeSetting;
  showStatusBar: boolean;
  defaultModule: ModuleKey;
  /** 数据库 / Redis 共用的左侧栏宽度 */
  sideWidth: number;
  /** rail 的模块顺序 */
  moduleOrder: ModuleKey[];
  /** 被隐藏的模块 */
  hiddenModules: ModuleKey[];
}

function read(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      const moduleOrder = Array.isArray(parsed.moduleOrder)
        ? (parsed.moduleOrder as ModuleKey[])
        : [...MODULE_ORDER];
      const stored = parsed.defaultModule as ModuleKey | undefined;
      // 旧版本的默认值（db / note）视为未设置：默认跟随排序第一个
      const legacy = stored === "db" || stored === "note";
      return {
        language: parsed.language ?? "system",
        theme: parsed.theme ?? "system",
        showStatusBar: parsed.showStatusBar ?? true,
        defaultModule:
          stored && !legacy ? stored : (moduleOrder[0] ?? "files"),
        sideWidth:
          typeof parsed.sideWidth === "number" && parsed.sideWidth !== 272
            ? parsed.sideWidth
            : 310,
        moduleOrder,
        hiddenModules: Array.isArray(parsed.hiddenModules)
          ? (parsed.hiddenModules as ModuleKey[])
          : [],
      };
    }
  } catch {
    /* 忽略损坏的本地配置 */
  }
  return {
    language: "system",
    theme: "system",
    showStatusBar: true,
    defaultModule: MODULE_ORDER[0] ?? "files",
    sideWidth: 310,
    moduleOrder: [...MODULE_ORDER],
    hiddenModules: [],
  };
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
  /** 启动后默认打开的模块 */
  defaultModule: ModuleKey;
  /** 数据库 / Redis 共用的左侧栏宽度 */
  sideWidth: number;
  /** rail 的模块顺序 */
  moduleOrder: ModuleKey[];
  /** 被隐藏的模块 */
  hiddenModules: ModuleKey[];
  /** 实际生效的语言 / 主题（跟随系统时会随系统变化） */
  lang: Lang;
  activeTheme: Theme;
  setLanguage: (value: LangSetting) => void;
  setTheme: (value: ThemeSetting) => void;
  setShowStatusBar: (value: boolean) => void;
  setDefaultModule: (value: ModuleKey) => void;
  setSideWidth: (value: number) => void;
  setModuleOrder: (order: ModuleKey[]) => void;
  setModuleVisible: (key: ModuleKey, visible: boolean) => void;
  resetModules: () => void;
  /** 监听系统主题变化 */
  syncSystem: () => void;
}

const initial = read();
applyTheme(resolveTheme(initial.theme));

function persist(state: {
  language: LangSetting;
  theme: ThemeSetting;
  showStatusBar: boolean;
  defaultModule: ModuleKey;
  /** 数据库 / Redis 共用的左侧栏宽度 */
  sideWidth: number;
  /** rail 的模块顺序 */
  moduleOrder: ModuleKey[];
  /** 被隐藏的模块 */
  hiddenModules: ModuleKey[];
}) {
  localStorage.setItem(KEY, JSON.stringify(state satisfies Persisted));
}

export const useUiStore = create<UiState>((set, get) => ({
  language: initial.language,
  theme: initial.theme,
  showStatusBar: initial.showStatusBar,
  defaultModule: initial.defaultModule,
  sideWidth: initial.sideWidth,
  moduleOrder: initial.moduleOrder,
  hiddenModules: initial.hiddenModules,
  lang: resolveLang(initial.language),
  activeTheme: resolveTheme(initial.theme),

  setLanguage: (value) => {
    persist({
      language: value,
      theme: get().theme,
      showStatusBar: get().showStatusBar,
      defaultModule: get().defaultModule,
      sideWidth: get().sideWidth,
      moduleOrder: get().moduleOrder,
      hiddenModules: get().hiddenModules,
    });
    set({ language: value, lang: resolveLang(value) });
  },

  setTheme: (value) => {
    persist({
      language: get().language,
      theme: value,
      showStatusBar: get().showStatusBar,
      defaultModule: get().defaultModule,
      sideWidth: get().sideWidth,
      moduleOrder: get().moduleOrder,
      hiddenModules: get().hiddenModules,
    });
    const active = resolveTheme(value);
    applyTheme(active);
    set({ theme: value, activeTheme: active });
  },

  setShowStatusBar: (value) => {
    persist({
      language: get().language,
      theme: get().theme,
      showStatusBar: value,
      defaultModule: get().defaultModule,
      sideWidth: get().sideWidth,
      moduleOrder: get().moduleOrder,
      hiddenModules: get().hiddenModules,
    });
    set({ showStatusBar: value });
  },

  setDefaultModule: (value) => {
    persist({
      language: get().language,
      theme: get().theme,
      showStatusBar: get().showStatusBar,
      defaultModule: value,
      sideWidth: get().sideWidth,
      moduleOrder: get().moduleOrder,
      hiddenModules: get().hiddenModules,
    });
    set({ defaultModule: value });
  },

  setSideWidth: (value) => {
    persist({
      language: get().language,
      theme: get().theme,
      showStatusBar: get().showStatusBar,
      defaultModule: get().defaultModule,
      sideWidth: value,
      moduleOrder: get().moduleOrder,
      hiddenModules: get().hiddenModules,
    });
    set({ sideWidth: value });
  },

  setModuleOrder: (order) => {
    persist({
      language: get().language,
      theme: get().theme,
      showStatusBar: get().showStatusBar,
      defaultModule: get().defaultModule,
      sideWidth: get().sideWidth,
      moduleOrder: order,
      hiddenModules: get().hiddenModules,
    });
    set({ moduleOrder: order });
  },

  resetModules: () => {
    const order = [...MODULE_ORDER];
    const defaultModule = order[0] ?? "files";
    persist({
      language: get().language,
      theme: get().theme,
      showStatusBar: get().showStatusBar,
      defaultModule,
      sideWidth: get().sideWidth,
      moduleOrder: order,
      hiddenModules: [],
    });
    set({ moduleOrder: order, hiddenModules: [], defaultModule });
  },

  setModuleVisible: (key, visible) => {
    const hidden = visible
      ? get().hiddenModules.filter((item) => item !== key)
      : [...get().hiddenModules.filter((item) => item !== key), key];
    persist({
      language: get().language,
      theme: get().theme,
      showStatusBar: get().showStatusBar,
      defaultModule: get().defaultModule,
      sideWidth: get().sideWidth,
      moduleOrder: get().moduleOrder,
      hiddenModules: hidden,
    });
    set({ hiddenModules: hidden });
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
