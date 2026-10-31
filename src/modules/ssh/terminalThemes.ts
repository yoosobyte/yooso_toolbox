import type { ITerminalOptions, ITheme } from "@xterm/xterm";
import { terminalThemeFor } from "../../theme";
import type { Theme } from "../../stores/uiStore";

/** xterm 的基础选项；主题在创建终端 / 切换主题时单独注入 */
export const TERMINAL_OPTIONS = {
  fontFamily: "'Cascadia Mono', 'JetBrains Mono', Consolas, 'Courier New', monospace",
  fontSize: 13,
  lineHeight: 1.25,
  cursorBlink: true,
  scrollback: 8000,
  convertEol: false,
  allowProposedApi: true,
} satisfies ITerminalOptions;

/** 按当前全局主题生成 xterm 配色 */
export function terminalTheme(theme: Theme): ITheme {
  return terminalThemeFor(theme);
}

/** 创建 Terminal 时使用的完整选项（基础选项 + 字体偏好 + 当前主题） */
export function terminalOptions(
  theme: Theme,
  font?: string,
  size?: number,
): ITerminalOptions {
  return {
    ...TERMINAL_OPTIONS,
    ...(font ? { fontFamily: font } : {}),
    ...(size ? { fontSize: size } : {}),
    theme: terminalTheme(theme),
  };
}
