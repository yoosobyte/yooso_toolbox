import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { userAgentFor } from "./browserUtils";
import type { BrowserTab } from "./types";

interface Params {
  native: boolean;
  tabs: BrowserTab[];
  activeId: string | null;
  /** 全局弹窗（如设置）打开时需要隐藏原生 WebView */
  obscured: boolean;
  frameRef: RefObject<HTMLDivElement | null>;
  /** 站点编辑弹窗是否打开（打开期间不恢复 WebView） */
  dialogOpenRef: RefObject<boolean>;
}

/**
 * 原生子 WebView 的创建 / 销毁 / 定位逻辑。
 * 状态本身仍由 BrowserModule 持有，这里只负责把 WebView 贴到内容区。
 */
export function useNativeWebviews({
  native,
  tabs,
  activeId,
  obscured,
  frameRef,
  dialogOpenRef,
}: Params) {
  const labelSeq = useRef(0);
  const webviewsRef = useRef<Map<string, Webview>>(new Map());
  const activeIdRef = useRef<string | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const fullscreenRef = useRef(false);
  activeIdRef.current = activeId;

  /**
   * 子 WebView 的坐标相对整个窗口，而 React 坐标相对网页视口（标题栏下方），
   * 需要补上窗口边框/标题栏的偏移。
   */
  const loadOrigin = async () => {
    if (originRef.current) return originRef.current;
    const isMac = /mac/i.test(navigator.userAgent);
    const isWindows = /windows/i.test(navigator.userAgent);
    try {
      const win = getCurrentWindow();
      const [scale, outer, fullscreen] = await Promise.all([
        win.scaleFactor(),
        win.outerPosition(),
        win.isFullscreen(),
      ]);
      fullscreenRef.current = fullscreen;
      // 全屏 / Windows：子 WebView 坐标相对窗口客户区，原点就是 0
      if (fullscreen || isWindows) {
        originRef.current = { x: 0, y: 0 };
        return originRef.current;
      }
      const candidates = [
        window.outerHeight - window.innerHeight,
        window.screenY - outer.y / scale,
      ];
      const y =
        candidates.find((value) => Number.isFinite(value) && value > 0 && value < 96) ??
        (isMac ? 28 : 0);
      originRef.current = { x: 0, y };
    } catch {
      originRef.current = { x: 0, y: isMac ? 28 : 0 };
    }
    return originRef.current;
  };

  /** 把子 WebView 对齐到内容区（React 坐标 + 主 WebView 偏移） */
  const placeWebview = async (webview: Webview, rect: DOMRect, show: boolean) => {
    if (rect.width < 1 || rect.height < 1) {
      await webview.hide().catch(() => undefined);
      return;
    }
    const origin = await loadOrigin();
    const dpr = window.devicePixelRatio || 1;
    const x = Math.round((origin.x + rect.left) * dpr);
    const y = Math.round((origin.y + rect.top) * dpr);
    await webview
      .setPosition(new PhysicalPosition(x, y))
      .catch(() => undefined);
    // 窗口模式底部多探 3px 盖住缝隙；全屏时窗口底边就是屏幕底边，不能再多探
    const bottomExtra = fullscreenRef.current ? 0 : Math.round(3 * dpr);
    await webview
      .setSize(
        new PhysicalSize(
          Math.ceil(rect.width * dpr) + 2,
          Math.ceil(rect.height * dpr) + bottomExtra,
        ),
      )
      .catch(() => undefined);
    await (show ? webview.show() : webview.hide()).catch(() => undefined);
  };

  /** 在内容区创建一个原生子 WebView（不受 iframe 的 X-Frame-Options 限制） */
  const createWebview = (tabId: string, url: string, show: boolean) => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    labelSeq.current += 1;
    const label = `browser_${labelSeq.current}`;
    try {
      const webview = new Webview(getCurrentWindow(), label, {
        url,
        userAgent: userAgentFor(url),
        // macOS：点击未激活的 WebView 时也把点击传进去，避免第一次点击被吞
        acceptFirstMouse: true,
        focus: true,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.ceil(rect.width) + 1,
        height: Math.ceil(rect.height) + 3,
      });
      webviewsRef.current.set(tabId, webview);
      // 创建后多次定位，避免 created 事件竞态 / 首帧未就绪
      void placeWebview(webview, rect, show);
      window.setTimeout(() => void placeWebview(webview, rect, show), 50);
      window.setTimeout(() => void placeWebview(webview, rect, show), 200);
      webview.once("tauri://created", () => {
        void placeWebview(webview, rect, show);
      });
      webview.once("tauri://error", () => {
        webviewsRef.current.delete(tabId);
      });
      // deepseek.com 首页的 canvas 覆盖层会拦截点击，注入穿透
      try {
        const host = new URL(url).hostname;
        if (host === "deepseek.com" || host === "www.deepseek.com") {
          const script =
            "document.querySelectorAll('canvas').forEach(function(c){c.style.pointerEvents='none';});";
          for (const delay of [1200, 3000, 6000]) {
            window.setTimeout(() => {
              void invoke("browser_eval", { label, script }).catch(() => undefined);
            }, delay);
          }
        }
      } catch {
        /* ignore */
      }
    } catch (error) {
      console.error("failed to create browser webview", error);
    }
  };

  const rebuildWebview = (tabId: string, url: string, show: boolean) => {
    if (!native) return;
    const existing = webviewsRef.current.get(tabId);
    if (existing) {
      void existing.close().catch(() => undefined);
      webviewsRef.current.delete(tabId);
    }
    createWebview(tabId, url, show);
  };

  /* tab 增删与激活切换：创建 / 关闭 / 显示隐藏子 WebView */
  useEffect(() => {
    if (!native) return;
    for (const [id, webview] of webviewsRef.current) {
      if (!tabs.some((tab) => tab.id === id)) {
        void webview.close().catch(() => undefined);
        webviewsRef.current.delete(id);
      }
    }
    for (const tab of tabs) {
      if (!webviewsRef.current.has(tab.id)) {
        createWebview(tab.id, tab.url, tab.id === activeId);
      }
    }
    for (const [id, webview] of webviewsRef.current) {
      void (id === activeId ? webview.show() : webview.hide()).catch(() => undefined);
    }
    if (activeId) {
      const activeWebview = webviewsRef.current.get(activeId);
      void activeWebview?.setFocus().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, activeId, native]);

  /* 内容区位置/尺寸变化时同步子 WebView；模块隐藏时全部隐藏 */
  useEffect(() => {
    if (!native) return;
    const frame = frameRef.current;
    if (!frame) return;
    const sync = () => {
      const rect = frame.getBoundingClientRect();
      const visible = rect.width > 1 && rect.height > 1;
      for (const [id, webview] of webviewsRef.current) {
        void placeWebview(webview, rect, visible && id === activeIdRef.current);
      }
    };
    const observer = new ResizeObserver(sync);
    observer.observe(frame);
    window.addEventListener("resize", sync);
    sync();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [native, activeId]);

  /* 窗口尺寸 / 全屏状态变化时，重新计算坐标原点 */
  useEffect(() => {
    if (!native) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onResized(() => {
        originRef.current = null;
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }, [native]);

  /* 组件卸载时销毁所有子 WebView */
  useEffect(() => {
    return () => {
      for (const webview of webviewsRef.current.values()) {
        void webview.close().catch(() => undefined);
      }
      webviewsRef.current.clear();
    };
  }, []);

  /** 弹窗 / 菜单打开时立即隐藏原生 WebView，避免被原生层遮挡 */
  const hideAllWebviews = () => {
    for (const webview of webviewsRef.current.values()) {
      void webview.hide().catch(() => undefined);
    }
  };

  /** 关闭弹层后恢复当前激活页面的 WebView（弹窗还开着时不恢复） */
  const showActiveWebview = () => {
    if (dialogOpenRef.current) return;
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    for (const [id, webview] of webviewsRef.current) {
      void placeWebview(webview, rect, id === activeIdRef.current);
    }
  };

  /* 全局弹窗（设置等）打开时隐藏 WebView，关闭后恢复 */
  useEffect(() => {
    if (!native) return;
    if (obscured) hideAllWebviews();
    else showActiveWebview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obscured, native]);

  return { rebuildWebview, hideAllWebviews, showActiveWebview };
}
