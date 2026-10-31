import { create } from "zustand";
import { loadStored, saveStored } from "../../storage";

/** 终端可选字体（值 → 实际 font-family 栈） */
export const TERMINAL_FONTS: Record<string, string> = {
  "Cascadia Mono": "'Cascadia Mono', Consolas, 'Courier New', monospace",
  "JetBrains Mono": "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace",
  "Fira Code": "'Fira Code', 'Cascadia Mono', Consolas, monospace",
  Menlo: "Menlo, Monaco, 'Courier New', monospace",
  "SF Mono": "'SF Mono', Menlo, Consolas, monospace",
  Consolas: "Consolas, 'Courier New', monospace",
  Monaco: "Monaco, Menlo, monospace",
};

export const TERMINAL_SIZES = [11, 12, 13, 14, 15, 16, 18, 20, 22];

export const DEFAULT_TERMINAL_FONT = "Cascadia Mono";
export const DEFAULT_TERMINAL_SIZE = 13;

const PREFS_KEY = "ssh.term";

export function fontStack(font: string): string {
  return TERMINAL_FONTS[font] ?? TERMINAL_FONTS[DEFAULT_TERMINAL_FONT];
}

interface TerminalPrefsState {
  font: string;
  size: number;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setFont: (font: string) => void;
  setSize: (size: number) => void;
}

function persist(font: string, size: number) {
  void saveStored(PREFS_KEY, JSON.stringify({ font, size }));
}

/** SSH 终端字体 / 字号偏好（存后端凭据库） */
export const useTerminalPrefs = create<TerminalPrefsState>((set, get) => ({
  font: DEFAULT_TERMINAL_FONT,
  size: DEFAULT_TERMINAL_SIZE,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await loadStored(PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { font?: string; size?: number };
        const font =
          parsed.font && parsed.font in TERMINAL_FONTS
            ? parsed.font
            : DEFAULT_TERMINAL_FONT;
        const size =
          typeof parsed.size === "number" &&
          TERMINAL_SIZES.includes(parsed.size)
            ? parsed.size
            : DEFAULT_TERMINAL_SIZE;
        set({ font, size });
      }
    } catch {
      /* 读取失败时用默认值 */
    } finally {
      set({ hydrated: true });
    }
  },

  setFont: (font) => {
    set({ font });
    persist(font, get().size);
  },

  setSize: (size) => {
    set({ size });
    persist(get().font, size);
  },
}));
