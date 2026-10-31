import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";
import { copyText, pasteText } from "../../clipboard";
import { useUiStore } from "../../stores/uiStore";
import { terminalOptions, terminalTheme } from "./terminalThemes";

/**
 * 创建一个挂好 fit / web-links 插件的 xterm 实例。
 * 实例的销毁与 SSH 连接生命周期仍由调用方（TerminalView）负责。
 */
export function createXterm(container: HTMLElement): { term: Terminal; fit: FitAddon } {
  const term = new Terminal(terminalOptions(useUiStore.getState().activeTheme));
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(
    new WebLinksAddon((_event, uri) => {
      void openUrl(uri).catch(() => undefined);
    }),
  );
  term.open(container);
  return { term, fit };
}

/**
 * 安装终端的复制 / 粘贴快捷键。
 * Windows/Linux 用 Ctrl+Shift+C/V（以及 Ctrl+Insert / Shift+Insert），
 * macOS 用 ⌘C / ⌘V（与 iTerm、系统终端一致）。
 */
export function installClipboardKeyHandler(term: Terminal): void {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const copySelection = () => {
    const selection = term.getSelection();
    if (selection) void copyText(selection).catch(() => undefined);
  };
  const pasteInto = () => {
    // 必须阻止默认行为，否则浏览器还会再粘一次（出现「cd /homecd /home」）
    void pasteText()
      .then((text) => {
        if (text) term.paste(text);
      })
      .catch(() => undefined);
  };

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") return true;

    // macOS：⌘C 复制、⌘V 粘贴
    if (isMac && event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.code === "KeyC") {
        event.preventDefault();
        event.stopPropagation();
        copySelection();
        return false;
      }
      if (event.code === "KeyV") {
        event.preventDefault();
        event.stopPropagation();
        pasteInto();
        return false;
      }
      if (event.code === "KeyK") {
        event.preventDefault();
        event.stopPropagation();
        term.clear();
        return false;
      }
    }

    if (event.ctrlKey && event.shiftKey && event.code === "KeyC") {
      event.preventDefault();
      event.stopPropagation();
      copySelection();
      return false;
    }
    if (event.ctrlKey && event.shiftKey && event.code === "KeyV") {
      event.preventDefault();
      event.stopPropagation();
      pasteInto();
      return false;
    }
    // Windows 终端的经典快捷键：Ctrl+Insert 复制、Shift+Insert 粘贴
    if (event.ctrlKey && !event.shiftKey && event.code === "Insert") {
      event.preventDefault();
      event.stopPropagation();
      copySelection();
      return false;
    }
    if (event.shiftKey && !event.ctrlKey && event.code === "Insert") {
      event.preventDefault();
      event.stopPropagation();
      pasteInto();
      return false;
    }
    return true;
  });
}

/**
 * 持有 xterm 实例引用，并在全局主题切换时同步终端配色。
 * 终端实例的创建 / 销毁属于连接生命周期，留在 TerminalView 中。
 */
export function useXterm() {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeTheme = useUiStore((state) => state.activeTheme);

  /* 主题切换时同步终端配色 */
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = terminalTheme(activeTheme);
    }
  }, [activeTheme]);

  return { termRef, fitRef };
}
