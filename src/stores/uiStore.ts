import { create } from "zustand";
import type { Lang, LangSetting } from "../i18n";
import { MODULE_ORDER, type ModuleKey } from "../modules/keys";
import { resolveLang } from "../i18n";
import { loadStored, saveStored } from "../storage";

export type ThemeSetting = "system" | "light" | "dark";
export type Theme = "light" | "dark";

/** 外观设置存在 localStorage（启动早期同步应用，避免主题闪烁） */
const APPEARANCE_KEY = "yooso.ui";
/** 布局设置存到后端凭据库（与敏感数据一起加密） */
const LAYOUT_KEY = "ui.layout";

interface Appearance {
  language: LangSetting;
  theme: ThemeSetting;
  showStatusBar: boolean;
}

interface Layout {
  /** 启动后默认打开的模块 */
  defaultModule: ModuleKey;
  /** 各模块左侧栏共用宽度 */
  sideWidth: number;
  /** rail 的模块顺序 */
  moduleOrder: ModuleKey[];
  /** 被隐藏的模块 */
  hiddenModules: ModuleKey[];
}

function defaultLayout(): Layout {
  return {
    defaultModule: MODULE_ORDER[0] ?? "files",
    sideWidth: 310,
    moduleOrder: [...MODULE_ORDER],
    hiddenModules: [],
  };
}

function parseLayout(raw: Partial<Layout> | null): Layout {
  const base = defaultLayout();
  if (!raw) return base;
  const moduleOrder = Array.isArray(raw.moduleOrder)
    ? (raw.moduleOrder as ModuleKey[])
    : base.moduleOrder;
  const stored = raw.defaultModule as ModuleKey | undefined;
  // 旧版本的默认值（db / note）视为未设置：默认跟随排序第一个
  const legacy = stored === "db" || stored === "note";
  return {
    defaultModule: stored && !legacy ? stored : (moduleOrder[0] ?? base.defaultModule),
    sideWidth:
      typeof raw.sideWidth === "number" && raw.sideWidth !== 272
        ? raw.sideWidth
        : base.sideWidth,
    moduleOrder,
    hiddenModules: Array.isArray(raw.hiddenModules)
      ? (raw.hiddenModules as ModuleKey[])
      : [],
  };
}

function readAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Appearance> & Partial<Layout>;
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

/** 旧版本把布局也塞在 yooso.ui 里，这里读出来用于一次性迁移 */
function readLegacyLayout(): Layout | null {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Layout>;
    if (
      parsed.defaultModule === undefined &&
      parsed.sideWidth === undefined &&
      parsed.moduleOrder === undefined &&
      parsed.hiddenModules === undefined
    ) {
      return null;
    }
    return parseLayout(parsed);
  } catch {
    return null;
  }
}

function persistAppearance(state: Appearance) {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

let layoutTimer: number | undefined;

/** 布局改动不频繁（拖动时较频繁），合并成一次写盘 */
function scheduleSaveLayout(state: Layout) {
  window.clearTimeout(layoutTimer);
  layoutTimer = window.setTimeout(() => {
    void saveStored(LAYOUT_KEY, JSON.stringify(state));
  }, 250);
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
  defaultModule: ModuleKey;
  sideWidth: number;
  moduleOrder: ModuleKey[];
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
  /** 从后端读取布局设置（启动解锁后调用一次） */
  hydrate: () => Promise<void>;
  /** 监听系统主题变化 */
  syncSystem: () => void;
}

const initialAppearance = readAppearance();
applyTheme(resolveTheme(initialAppearance.theme));
const initialLayout = defaultLayout();

function layoutOf(state: {
  defaultModule: ModuleKey;
  sideWidth: number;
  moduleOrder: ModuleKey[];
  hiddenModules: ModuleKey[];
}): Layout {
  return {
    defaultModule: state.defaultModule,
    sideWidth: state.sideWidth,
    moduleOrder: state.moduleOrder,
    hiddenModules: state.hiddenModules,
  };
}

export const useUiStore = create<UiState>((set, get) => ({
  ...initialAppearance,
  ...initialLayout,
  lang: resolveLang(initialAppearance.language),
  activeTheme: resolveTheme(initialAppearance.theme),

  setLanguage: (value) => {
    persistAppearance({
      language: value,
      theme: get().theme,
      showStatusBar: get().showStatusBar,
    });
    set({ language: value, lang: resolveLang(value) });
  },

  setTheme: (value) => {
    persistAppearance({
      language: get().language,
      theme: value,
      showStatusBar: get().showStatusBar,
    });
    const active = resolveTheme(value);
    applyTheme(active);
    set({ theme: value, activeTheme: active });
  },

  setShowStatusBar: (value) => {
    persistAppearance({
      language: get().language,
      theme: get().theme,
      showStatusBar: value,
    });
    set({ showStatusBar: value });
  },

  setDefaultModule: (value) => {
    set({ defaultModule: value });
    scheduleSaveLayout(layoutOf(get()));
  },

  setSideWidth: (value) => {
    set({ sideWidth: value });
    scheduleSaveLayout(layoutOf(get()));
  },

  setModuleOrder: (order) => {
    set({ moduleOrder: order });
    scheduleSaveLayout(layoutOf(get()));
  },

  resetModules: () => {
    const order = [...MODULE_ORDER];
    set({
      moduleOrder: order,
      hiddenModules: [],
      defaultModule: order[0] ?? "files",
    });
    scheduleSaveLayout(layoutOf(get()));
  },

  setModuleVisible: (key, visible) => {
    const hidden = visible
      ? get().hiddenModules.filter((item) => item !== key)
      : [...get().hiddenModules.filter((item) => item !== key), key];
    set({ hiddenModules: hidden });
    scheduleSaveLayout(layoutOf(get()));
  },

  hydrate: async () => {
    try {
      const raw = await loadStored(LAYOUT_KEY);
      if (raw) {
        set(parseLayout(JSON.parse(raw) as Partial<Layout>));
        return;
      }
      const legacy = readLegacyLayout();
      if (legacy) {
        set(legacy);
        await saveStored(LAYOUT_KEY, JSON.stringify(legacy));
        // 旧数据里还混着布局字段，重写成只含外观
        persistAppearance({
          language: get().language,
          theme: get().theme,
          showStatusBar: get().showStatusBar,
        });
      }
    } catch {
      /* 读取失败时保持默认布局 */
    }
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
