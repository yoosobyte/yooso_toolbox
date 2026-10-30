import { useEffect, useRef, useState } from "react";
import { Button, Dropdown, Input, Modal, Switch, Tooltip, Typography } from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  HomeOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { inTauri } from "../../save";
import { BrowserNavIcon } from "../../components/NavIcons";
import { loadSites, saveSites, type BrowserSite } from "./sites";
import { loadFavicon } from "./favicon";
import { loadPageTitle } from "./pageInfo";

interface BrowserTab {
  id: string;
  title: string;
  url: string;
  history: string[];
  historyIndex: number;
  /** 站点自定义的 favicon 地址 */
  icon?: string;
}

/** 百度对 Safari UA 的 https 页面会跳转到 http，导致 WebView 空白，需要 Chrome UA */
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function userAgentFor(url: string): string | undefined {
  try {
    const host = new URL(url).hostname;
    if (host === "baidu.com" || host.endsWith(".baidu.com")) return CHROME_UA;
  } catch {
    /* ignore */
  }
  return undefined;
}

const NEW_SITE_COLORS = [
  "#008373",
  "#2932e1",
  "#646cff",
  "#f48024",
  "#22c55e",
  "#a855f7",
  "#ec4899",
  "#06b6d4",
];

function normalizeUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function titleFor(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** 依次尝试的图标地址：站点自带 favicon → 第三方图标服务 */
function faviconSources(url: string): string[] {
  const sources: string[] = [];
  try {
    const { origin, hostname } = new URL(url);
    sources.push(`${origin}/favicon.ico`);
    sources.push(`https://www.google.com/s2/favicons?domain=${hostname}&sz=64`);
    sources.push(`https://favicon.im/${hostname}?larger=true`);
  } catch {
    /* ignore */
  }
  return sources;
}

/**
 * tab 图标：先预加载验证能真正解码，再挂到 <img> 上。
 * 直接挂载时部分站点的 favicon 会返回 HTML/空图导致显示成黑块。
 */
function TabFavicon({ url, icon }: { url: string; icon?: string }) {
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    if (icon) {
      setResolved(icon);
      return;
    }
    if (inTauri()) {
      // 原生环境：交给 Rust 抓取，避免跨域/防盗链导致拿不到图标
      void loadFavicon(url).then((data) => {
        if (!cancelled && data) setResolved(data);
      });
      return () => {
        cancelled = true;
      };
    }
    // 浏览器环境（调试用）：预加载探测
    const sources = faviconSources(url);
    const test = (source: string) =>
      new Promise<string | null>((resolve) => {
        const image = new Image();
        image.onload = () =>
          resolve(
            image.naturalWidth >= 8 && image.naturalHeight >= 8 ? source : null,
          );
        image.onerror = () => resolve(null);
        image.src = source;
      });
    (async () => {
      for (const source of sources) {
        const ok = await test(source);
        if (cancelled) return;
        if (ok) {
          setResolved(ok);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, icon]);

  if (!resolved) return <span className="browser-tab-favicon-placeholder" />;
  return <img className="browser-tab-favicon" src={resolved} alt="" />;
}

interface Props {
  /** 全局弹窗（如设置）打开时，需要隐藏原生 WebView，避免遮挡 */
  obscured?: boolean;
}

export default function BrowserModule({ obscured = false }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const [native] = useState(() => inTauri());
  const [sites, setSites] = useState<BrowserSite[]>(loadSites);
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [reloadSeq, setReloadSeq] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<BrowserSite | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const tabSeq = useRef(0);
  const labelSeq = useRef(0);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const visibleRef = useRef(false);
  const autoOpenRef = useRef<() => void>(() => undefined);
  const webviewsRef = useRef<Map<string, Webview>>(new Map());
  const activeIdRef = useRef<string | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const dialogOpenRef = useRef(false);
  activeIdRef.current = activeId;

  const active = tabs.find((tab) => tab.id === activeId) ?? null;
  const canBack = Boolean(active && active.historyIndex > 0);
  const canForward = Boolean(
    active && active.historyIndex < active.history.length - 1,
  );

  /**
   * 子 WebView 的坐标相对整个窗口，而 React 坐标相对网页视口（标题栏下方），
   * 需要补上窗口边框/标题栏的偏移。
   */
  const loadOrigin = async () => {
    if (originRef.current) return originRef.current;
    const isMac = /mac/i.test(navigator.userAgent);
    try {
      const win = getCurrentWindow();
      const [scale, outer] = await Promise.all([
        win.scaleFactor(),
        win.outerPosition(),
      ]);
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
    // 尺寸向上取整，底部再多探约 3px，避免缩放取整后露出缝隙
    await webview
      .setSize(
        new PhysicalSize(
          Math.ceil(rect.width * dpr) + 2,
          Math.ceil(rect.height * dpr) + Math.round(3 * dpr),
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

  /* 站点配置持久化 */
  useEffect(() => {
    saveSites(sites);
  }, [sites]);

  const openUrlInTab = (url: string, title?: string, icon?: string) => {
    tabSeq.current += 1;
    const id = `browser-tab-${Date.now().toString(36)}-${tabSeq.current}`;
    const tab: BrowserTab = {
      id,
      title: title ?? titleFor(url),
      url,
      history: [url],
      historyIndex: 0,
      icon,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveId(id);
    setAddress(url);
    setReloadSeq(0);
    if (!title) {
      void loadPageTitle(url).then((pageTitle) => {
        if (!pageTitle) return;
        setTabs((prev) =>
          prev.map((item) =>
            item.id === id && item.url === url
              ? { ...item, title: pageTitle }
              : item,
          ),
        );
      });
    }
  };

  /** 进入浏览器模块时，把「自动打开」的站点补成 tab */
  autoOpenRef.current = () => {
    for (const site of sites) {
      if (!site.autoOpen) continue;
      if (tabs.some((tab) => tab.url === site.url)) continue;
      openUrlInTab(site.url, site.name, site.icon);
    }
  };

  /* 模块可见时自动打开标记的站点；切走只隐藏 WebView，保留已打开的 tab */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const visible = el.getBoundingClientRect().width > 0;
      if (visible && !visibleRef.current) {
        visibleRef.current = true;
        autoOpenRef.current();
      } else if (!visible) {
        visibleRef.current = false;
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const focusTab = (id: string) => {
    setActiveId(id);
    const tab = tabs.find((item) => item.id === id);
    if (tab) setAddress(tab.url);
  };

  const closeTab = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next);
    if (activeId === id) {
      const fallback = next[index] ?? next[index - 1] ?? null;
      setActiveId(fallback?.id ?? null);
      setAddress(fallback?.url ?? "");
    }
  };

  const navigate = (raw: string) => {
    const url = normalizeUrl(raw);
    if (!url) return;
    if (!active) {
      openUrlInTab(url);
      return;
    }
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== active.id) return tab;
        const history = tab.history.slice(0, tab.historyIndex + 1);
        history.push(url);
        return {
          ...tab,
          url,
          title: titleFor(url),
          history,
          historyIndex: history.length - 1,
        };
      }),
    );
    setAddress(url);
    setReloadSeq(0);
    rebuildWebview(active.id, url, true);
    void loadPageTitle(url).then((pageTitle) => {
      if (!pageTitle) return;
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === active.id && tab.url === url
            ? { ...tab, title: pageTitle }
            : tab,
        ),
      );
    });
  };

  const travel = (delta: number) => {
    if (!active) return;
    const index = active.historyIndex + delta;
    const url = active.history[index];
    if (!url) return;
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === active.id
          ? { ...tab, url, title: titleFor(url), historyIndex: index }
          : tab,
      ),
    );
    setAddress(url);
    setReloadSeq(0);
    rebuildWebview(active.id, url, true);
  };

  const reload = () => {
    setReloadSeq((seq) => seq + 1);
    if (active) rebuildWebview(active.id, active.url, true);
  };

  const goHome = () => {
    setActiveId(null);
    setAddress("");
  };

  /* ---------------------------- 站点卡片管理 ---------------------------- */

  const patchSite = (id: string, next: Partial<BrowserSite>) => {
    setSites((prev) =>
      prev.map((site) => (site.id === id ? { ...site, ...next } : site)),
    );
  };

  const gotoSite = (site: BrowserSite) => {
    const existing = tabs.find((tab) => tab.url === site.url);
    if (existing) focusTab(existing.id);
    else openUrlInTab(site.url, site.name, site.icon);
  };

  const openEditor = (site: BrowserSite | null) => {
    dialogOpenRef.current = true;
    hideAllWebviews();
    setEditingSite(site);
    setDraftName(site?.name ?? "");
    setDraftUrl(site?.url ?? "");
    setEditorOpen(true);
  };

  const saveEditor = () => {
    const name = draftName.trim();
    const url = normalizeUrl(draftUrl);
    if (!name || !url) return;
    if (editingSite) {
      setSites((prev) =>
        prev.map((site) =>
          site.id === editingSite.id ? { ...site, name, url } : site,
        ),
      );
    } else {
      setSites((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          name,
          url,
          color: NEW_SITE_COLORS[prev.length % NEW_SITE_COLORS.length],
          autoOpen: false,
        },
      ]);
    }
    setEditorOpen(false);
  };

  const removeSite = async (site: BrowserSite) => {
    const message = t("browser.deleteSiteConfirm", { name: site.name });
    let ok = false;
    try {
      ok = inTauri()
        ? await confirm(message, {
            title: t("browser.deleteSite"),
            kind: "warning",
            okLabel: t("common.delete"),
            cancelLabel: t("common.cancel"),
          })
        : window.confirm(message);
    } catch {
      ok = false;
    }
    if (!ok) return;
    setSites((prev) => prev.filter((item) => item.id !== site.id));
  };

  return (
    <div className="module browser-module" ref={rootRef}>
      <header className="module-head">
        <span className="module-icon">
          <BrowserNavIcon />
        </span>
        <div>
          <Typography.Text strong style={{ fontSize: 14 }}>
            {t("module.browser")}
          </Typography.Text>
          <div className="module-desc">{t("module.browserDesc")}</div>
        </div>
        <span style={{ flex: 1 }} />
      </header>

      <div className="browser-tabs">
        <div
          className={`browser-tab${active ? "" : " active"}`}
          role="button"
          tabIndex={0}
          onClick={goHome}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              goHome();
            }
          }}
        >
          <HomeOutlined />
          {t("browser.home")}
        </div>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`browser-tab${tab.id === activeId ? " active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => focusTab(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                focusTab(tab.id);
              }
            }}
          >
            <TabFavicon key={tab.url} url={tab.url} icon={tab.icon} />
            <span className="browser-tab-title">{tab.title}</span>
            <button
              type="button"
              className="browser-tab-close"
              title={t("common.close")}
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
            >
              <CloseOutlined />
            </button>
          </div>
        ))}
      </div>

      <div className="browser-bar">
        <Tooltip title={t("browser.back")}>
          <Button
            size="small"
            type="text"
            icon={<ArrowLeftOutlined />}
            disabled={!canBack}
            onClick={() => travel(-1)}
          />
        </Tooltip>
        <Tooltip title={t("browser.forward")}>
          <Button
            size="small"
            type="text"
            icon={<ArrowRightOutlined />}
            disabled={!canForward}
            onClick={() => travel(1)}
          />
        </Tooltip>
        <Tooltip title={t("browser.reload")}>
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            disabled={!active}
            onClick={reload}
          />
        </Tooltip>
        <Input
          className="browser-address"
          value={address}
          placeholder={t("browser.addressPlaceholder")}
          onChange={(event) => setAddress(event.target.value)}
          onPressEnter={() => navigate(address)}
          allowClear
        />
        <Button icon={<ArrowRightOutlined />} onClick={() => navigate(address)}>
          {t("browser.go")}
        </Button>
        <Tooltip title={t("browser.openExternal")}>
          <Button
            icon={<ExportOutlined />}
            disabled={!active}
            onClick={() => {
              if (active) void openUrl(active.url);
            }}
          />
        </Tooltip>
      </div>

      <div className="browser-content">
        {active ? (
          <div className="browser-frame-wrap">
            {native ? (
              <div className="browser-native-frame" ref={frameRef} />
            ) : (
              <iframe
                key={`${active.id}-${reloadSeq}`}
                className="browser-frame"
                title={active.title}
                src={active.url}
                referrerPolicy="no-referrer-when-downgrade"
                allow="clipboard-read; clipboard-write"
              />
            )}
          </div>
        ) : (
          <div className="browser-home">
            <div className="browser-home-head">
              <div className="browser-home-title">{t("browser.homeTitle")}</div>
              <div className="browser-home-desc">{t("browser.homeDesc")}</div>
            </div>
            <div className="browser-cards">
              {sites.map((site) => (
                <div
                  className="browser-card"
                  key={site.id}
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    const target = event.target;
                    // 下拉菜单/弹窗通过 portal 渲染，React 事件仍会冒泡到卡片，要忽略掉
                    if (
                      !(target instanceof Node) ||
                      !event.currentTarget.contains(target)
                    ) {
                      return;
                    }
                    // 右侧开关 / 更多按钮的点击不触发卡片打开
                    if (
                      target instanceof Element &&
                      target.closest(".browser-card-side")
                    ) {
                      return;
                    }
                    gotoSite(site);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      gotoSite(site);
                    }
                  }}
                >
                  <span
                    className="browser-card-icon"
                    style={{ background: site.color }}
                  >
                    {site.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="browser-card-main">
                    <div className="browser-card-name">{site.name}</div>
                    <div className="browser-card-url">{site.url}</div>
                  </div>
                  <div className="browser-card-side">
                    <Dropdown
                      trigger={["click"]}
                      onOpenChange={(open) => {
                        if (open) hideAllWebviews();
                        else showActiveWebview();
                      }}
                      menu={{
                        items: [
                          {
                            key: "goto",
                            label: t("browser.goto"),
                            icon: <ExportOutlined />,
                          },
                          {
                            key: "edit",
                            label: t("browser.edit"),
                            icon: <EditOutlined />,
                          },
                          { type: "divider" as const },
                          {
                            key: "delete",
                            label: t("common.delete"),
                            icon: <DeleteOutlined />,
                            danger: true,
                          },
                        ],
                        onClick: ({ key }) => {
                          if (key === "goto") gotoSite(site);
                          else if (key === "edit") openEditor(site);
                          else if (key === "delete") removeSite(site);
                        },
                      }}
                    >
                      <button
                        type="button"
                        className="browser-card-more"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <MoreOutlined />
                      </button>
                    </Dropdown>
                    <Tooltip title={t("browser.autoOpen")}>
                      <span
                        className="browser-card-switch"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Switch
                          size="small"
                          checked={site.autoOpen}
                          onChange={(on) => patchSite(site.id, { autoOpen: on })}
                        />
                      </span>
                    </Tooltip>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="browser-card browser-card-add"
                onClick={() => openEditor(null)}
              >
                <span className="browser-card-add-icon">
                  <PlusOutlined />
                </span>
                <span>{t("browser.addSite")}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={editorOpen}
        title={editingSite ? t("browser.editSite") : t("browser.addSite")}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        onOk={saveEditor}
        onCancel={() => setEditorOpen(false)}
        afterClose={() => {
          dialogOpenRef.current = false;
          showActiveWebview();
        }}
        width={480}
      >
        <div className="browser-site-form">
          <label className="browser-site-field">
            <span>{t("browser.siteName")}</span>
            <Input
              autoFocus
              value={draftName}
              placeholder={t("browser.siteNamePlaceholder")}
              onChange={(event) => setDraftName(event.target.value)}
            />
          </label>
          <label className="browser-site-field">
            <span>{t("browser.siteUrl")}</span>
            <Input
              value={draftUrl}
              placeholder={t("browser.siteUrlPlaceholder")}
              onChange={(event) => setDraftUrl(event.target.value)}
              onPressEnter={saveEditor}
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
