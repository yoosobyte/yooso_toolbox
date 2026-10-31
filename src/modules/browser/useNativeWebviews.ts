import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  /** 页面标题变化：把某个标签的标题同步成页面真实 document.title */
  onTitle: (tabId: string, title: string) => void;
}

/**
 * Rust 侧刚创建完的 WebView 不一定立刻能被 getAllWebviews 看到，
 * 这里短轮询几次再放弃。
 */
async function waitForWebview(label: string, tries = 8): Promise<Webview | null> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const found = await Webview.getByLabel(label);
    if (found) return found;
    await new Promise((resolve) => window.setTimeout(resolve, 30));
  }
  return null;
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
  onTitle,
}: Params) {
  const labelSeq = useRef(0);
  const webviewsRef = useRef<Map<string, Webview>>(new Map());
  /** 正在创建中的标签（创建是异步的，避免重复创建） */
  const pendingRef = useRef<Set<string>>(new Set());
  /** 每个标签的创建代次：重建后旧的创建结果要丢弃 */
  const generationRef = useRef<Map<string, number>>(new Map());
  /** 子 WebView label → 标签页 id（标题事件里只有 label） */
  const labelToTabRef = useRef<Map<string, string>>(new Map());
  /** 建 WebView 之间页面就发来的标题，等映射建立后再补上 */
  const pendingTitlesRef = useRef<Map<string, string>>(new Map());
  const activeIdRef = useRef<string | null>(null);
  const tabsRef = useRef<BrowserTab[]>(tabs);
  const onTitleRef = useRef(onTitle);
  const obscuredRef = useRef(obscured);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  activeIdRef.current = activeId;
  tabsRef.current = tabs;
  onTitleRef.current = onTitle;
  obscuredRef.current = obscured;

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
      const [scale, inner, outer, fullscreen] = await Promise.all([
        win.scaleFactor(),
        win.innerPosition(),
        win.outerPosition(),
        win.isFullscreen(),
      ]);
      // 全屏 / Windows：子 WebView 坐标相对窗口客户区，原点就是 0
      if (fullscreen || isWindows) {
        originRef.current = { x: 0, y: 0 };
        return originRef.current;
      }
      // 客户区相对窗口外框的偏移 = 标题栏高度。
      // 注意：WKWebView 里 window.outerHeight 是 0，innerHeight 却是真实值，
      // 旧逻辑会算出负数被丢弃、退回硬编码 28，实际标题栏是 31~32 时
      // 子 WebView 就会被抬高几像素、盖住工具栏底部。
      const candidates = [
        (inner.y - outer.y) / scale,
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
    // 窗口和全屏统一尺寸：不再给窗口模式额外多探 3px
    await webview
      .setSize(
        new PhysicalSize(
          Math.ceil(rect.width * dpr) + 2,
          Math.ceil(rect.height * dpr),
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
    const generation = (generationRef.current.get(tabId) ?? 0) + 1;
    generationRef.current.set(tabId, generation);
    pendingRef.current.add(tabId);
    // 由 Rust 侧创建，才能挂上 on_navigation / on_new_window：页面里 target=_blank
    // 或 window.open 的开窗请求会被转成 browser:new-window 事件，由主界面开新标签页。
    void invoke("browser_create_webview", {
      label,
      url,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.ceil(rect.width) + 1,
      height: Math.ceil(rect.height),
      userAgent: userAgentFor(url) ?? null,
    })
      .then(() => waitForWebview(label))
      .then((webview) => {
        const latest = generationRef.current.get(tabId) === generation;
        if (latest) pendingRef.current.delete(tabId);
        if (!webview) return;
        // 创建是异步的：这期间标签页可能被关掉，或又被重建过一次
        if (!latest || !tabsRef.current.some((tab) => tab.id === tabId)) {
          void webview.close().catch(() => undefined);
          return;
        }
        webviewsRef.current.set(tabId, webview);
        labelToTabRef.current.set(label, tabId);
        // 页面可能在映射建立前就改了标题，这里补一次
        const pendingTitle = pendingTitlesRef.current.get(label);
        if (pendingTitle) {
          pendingTitlesRef.current.delete(label);
          onTitleRef.current(tabId, pendingTitle);
        }
        // 创建后多次定位，避免首帧未就绪 / 尺寸还在变化
        void placeWebview(webview, rect, show);
        window.setTimeout(() => void placeWebview(webview, rect, tabId === activeIdRef.current), 50);
        window.setTimeout(() => void placeWebview(webview, rect, tabId === activeIdRef.current), 200);
      })
      .catch((error) => {
        if (generationRef.current.get(tabId) === generation) {
          pendingRef.current.delete(tabId);
        }
        console.error("failed to create browser webview", error);
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
  };

  const rebuildWebview = (tabId: string, url: string, show: boolean) => {
    if (!native) return;
    const existing = webviewsRef.current.get(tabId);
    if (existing) {
      labelToTabRef.current.delete(existing.label);
      void existing.close().catch(() => undefined);
      webviewsRef.current.delete(tabId);
    }
    pendingRef.current.delete(tabId);
    createWebview(tabId, url, show);
  };

  /* tab 增删与激活切换：创建 / 关闭 / 显示隐藏子 WebView。
     标题变化也会产生新的 tabs 数组，这里只关心「哪些标签、各自的地址」，
     用 tabsKey 做依赖，避免页面频繁改标题时反复 show/hide/setFocus。 */
  const tabsKey = tabs.map((tab) => `${tab.id}\u0000${tab.url}`).join("\u0001");
  useEffect(() => {
    if (!native) return;
    const list = tabsRef.current;
    for (const [id, webview] of webviewsRef.current) {
      if (!list.some((tab) => tab.id === id)) {
        labelToTabRef.current.delete(webview.label);
        void webview.close().catch(() => undefined);
        webviewsRef.current.delete(id);
      }
    }
    for (const tab of list) {
      if (!webviewsRef.current.has(tab.id) && !pendingRef.current.has(tab.id)) {
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
  }, [tabsKey, activeId, native]);

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
      labelToTabRef.current.clear();
      pendingTitlesRef.current.clear();
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
    // 站点编辑弹窗 / 全局弹窗还开着时不恢复，避免原生层盖住弹层
    if (dialogOpenRef.current || obscuredRef.current) return;
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    for (const [id, webview] of webviewsRef.current) {
      void placeWebview(webview, rect, id === activeIdRef.current);
    }
  };

  /* 页面标题实时同步到标签页 */
  useEffect(() => {
    if (!native) return;
    let unlisten: (() => void) | undefined;
    void listen<{ label: string; title: string }>("browser:title", (event) => {
      const label = event.payload?.label;
      const title = (event.payload?.title ?? "").trim();
      if (!label || !title) return;
      const tabId = labelToTabRef.current.get(label);
      if (!tabId) {
        pendingTitlesRef.current.set(label, title);
        return;
      }
      onTitleRef.current(tabId, title);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }, [native]);

  /* 全局弹窗（设置等）打开时隐藏 WebView，关闭后恢复 */
  useEffect(() => {
    if (!native) return;
    if (obscured) hideAllWebviews();
    else showActiveWebview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obscured, native]);

  return { rebuildWebview, hideAllWebviews, showActiveWebview };
}
