import { theme, type ThemeConfig } from "antd";

/** 全局深色主题：偏「终端工具」的冷色调 */
export const darkThemeConfig: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: "#3b82f6",
    colorInfo: "#3b82f6",
    colorSuccess: "#22c55e",
    colorWarning: "#f59e0b",
    colorError: "#ef4444",
    borderRadius: 8,
    colorBgLayout: "#0a0e14",
    colorBgContainer: "#0f1520",
    colorBgElevated: "#141b28",
    colorBorder: "#243044",
    colorBorderSecondary: "#1a2332",
    colorText: "#e6ebf2",
    colorTextSecondary: "#93a1b5",
    fontFamily:
      "'Inter', 'Segoe UI', 'Microsoft YaHei', system-ui, -apple-system, sans-serif",
    fontSize: 13,
    controlHeight: 32,
  },
  components: {
    Layout: {
      siderBg: "#0a0e14",
      bodyBg: "#0a0e14",
      headerBg: "#0a0e14",
    },
    Menu: {
      darkItemBg: "transparent",
      darkSubMenuItemBg: "transparent",
      darkItemSelectedBg: "#182234",
      darkItemSelectedColor: "#dbeafe",
    },
    Table: {
      headerBg: "#131b28",
      rowHoverBg: "#182234",
      borderColor: "#1a2332",
    },
    Modal: {
      contentBg: "#0f1520",
      headerBg: "#0f1520",
    },
    Input: {
      activeBorderColor: "#3b82f6",
    },
  },
};

/** 全局浅色主题：同一套冷色调，提高对比度适配日间使用 */
export const lightThemeConfig: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: "#2f6fed",
    colorInfo: "#2f6fed",
    colorSuccess: "#16a34a",
    colorWarning: "#d97706",
    colorError: "#dc2626",
    borderRadius: 8,
    colorBgLayout: "#f5f7fb",
    colorBgContainer: "#ffffff",
    colorBgElevated: "#ffffff",
    colorBorder: "#c8d3e2",
    colorBorderSecondary: "#dde4ee",
    colorText: "#16202e",
    colorTextSecondary: "#5f7086",
    fontFamily:
      "'Inter', 'Segoe UI', 'Microsoft YaHei', system-ui, -apple-system, sans-serif",
    fontSize: 13,
    controlHeight: 32,
  },
  components: {
    Layout: {
      siderBg: "#f5f7fb",
      bodyBg: "#f5f7fb",
      headerBg: "#f5f7fb",
    },
    Table: {
      headerBg: "#eef2f8",
      rowHoverBg: "#eef2f8",
      borderColor: "#dde4ee",
    },
    Modal: {
      contentBg: "#ffffff",
      headerBg: "#ffffff",
    },
    Input: {
      activeBorderColor: "#2f6fed",
    },
  },
};

/** xterm 终端配色：跟随主题 */
export function terminalThemeFor(themeName: "light" | "dark") {
  if (themeName === "light") {
    return {
      background: "#ffffff",
      foreground: "#16202e",
      cursor: "#2f6fed",
      cursorAccent: "#ffffff",
      selectionBackground: "#bfdbfe",
      black: "#16202e",
      red: "#dc2626",
      green: "#16a34a",
      yellow: "#b45309",
      blue: "#2f6fed",
      magenta: "#7c3aed",
      cyan: "#0e7490",
      white: "#e2e8f0",
      brightBlack: "#64748b",
      brightRed: "#ef4444",
      brightGreen: "#22c55e",
      brightYellow: "#d97706",
      brightBlue: "#3b82f6",
      brightMagenta: "#a855f7",
      brightCyan: "#06b6d4",
      brightWhite: "#0f172a",
    };
  }
  return {
    background: "#0a0e14",
    foreground: "#d5dde8",
    cursor: "#3b82f6",
    cursorAccent: "#0a0e14",
    selectionBackground: "#1e3a8a88",
    black: "#1b2434",
    red: "#f87171",
    green: "#4ade80",
    yellow: "#fbbf24",
    blue: "#60a5fa",
    magenta: "#c084fc",
    cyan: "#22d3ee",
    white: "#e5e7eb",
    brightBlack: "#64748b",
    brightRed: "#fca5a5",
    brightGreen: "#86efac",
    brightYellow: "#fde68a",
    brightBlue: "#93c5fd",
    brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9",
    brightWhite: "#f8fafc",
  };
}
