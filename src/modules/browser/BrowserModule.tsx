import { useEffect, useRef, useState } from "react";
import { Typography } from "antd";
import { openUrl } from "@tauri-apps/plugin-opener";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { inTauri } from "../../save";
import { BrowserNavIcon } from "../../components/NavIcons";
import { loadSites, saveSites, type BrowserSite } from "./sites";
import { loadPageTitle } from "./pageInfo";
import { NEW_SITE_COLORS, normalizeUrl, titleFor } from "./browserUtils";
import type { BrowserTab } from "./types";
import { BrowserTabs } from "./BrowserTabs";
import { BrowserToolbar } from "./BrowserToolbar";
import { BrowserContent } from "./BrowserContent";
import { SiteEditorModal } from "./SiteEditorModal";
import { useNativeWebviews } from "./useNativeWebviews";

interface Props {
  /** 全局弹窗（如设置）打开时，需要隐藏原生 WebView，避免遮挡 */
  obscured?: boolean;
  /** 从外部（设置页链接）请求打开某个地址 */
  pendingUrl?: string | null;
  onConsumed?: () => void;
}

export default function BrowserModule({
  obscured = false,
  pendingUrl = null,
  onConsumed,
}: Props) {
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const visibleRef = useRef(false);
  const autoOpenRef = useRef<() => void>(() => undefined);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dialogOpenRef = useRef(false);

  const active = tabs.find((tab) => tab.id === activeId) ?? null;
  const canBack = Boolean(active && active.historyIndex > 0);
  const canForward = Boolean(
    active && active.historyIndex < active.history.length - 1,
  );

  const { rebuildWebview, hideAllWebviews, showActiveWebview } =
    useNativeWebviews({
      native,
      tabs,
      activeId,
      obscured,
      frameRef,
      dialogOpenRef,
    });

  /* 站点配置持久化 */
  useEffect(() => {
    saveSites(sites);
  }, [sites]);

  /* 设置页等外部入口请求在内部浏览器打开链接 */
  const pendingUrlRef = useRef<string | null>(pendingUrl);
  pendingUrlRef.current = pendingUrl;
  useEffect(() => {
    if (!pendingUrl) return;
    // 等自动打开逻辑先占好 tab，再把链接放到最右侧
    const timer = window.setTimeout(() => {
      const queued = pendingUrlRef.current;
      if (!queued) return;
      pendingUrlRef.current = null;
      openUrlInTab(queued);
      onConsumed?.();
    }, 150);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUrl]);

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
        const queued = pendingUrlRef.current;
        if (queued) {
          pendingUrlRef.current = null;
          openUrlInTab(queued);
          onConsumed?.();
        }
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

      <BrowserTabs
        tabs={tabs}
        activeId={activeId}
        hasActive={Boolean(active)}
        t={t}
        onHome={goHome}
        onFocus={focusTab}
        onClose={closeTab}
      />

      <BrowserToolbar
        t={t}
        address={address}
        canBack={canBack}
        canForward={canForward}
        hasActive={Boolean(active)}
        onAddressChange={setAddress}
        onNavigate={() => navigate(address)}
        onTravel={travel}
        onReload={reload}
        onOpenExternal={() => {
          if (active) void openUrl(active.url);
        }}
      />

      <BrowserContent
        active={active}
        native={native}
        reloadSeq={reloadSeq}
        frameRef={frameRef}
        sites={sites}
        t={t}
        onOpenSite={gotoSite}
        onEditSite={openEditor}
        onRemoveSite={removeSite}
        onToggleAutoOpen={(site, autoOpen) =>
          patchSite(site.id, { autoOpen })
        }
        onMenuOpenChange={(open) => {
          if (open) hideAllWebviews();
          else showActiveWebview();
        }}
        onAddSite={() => openEditor(null)}
      />

      <SiteEditorModal
        open={editorOpen}
        editing={Boolean(editingSite)}
        draftName={draftName}
        draftUrl={draftUrl}
        t={t}
        onNameChange={setDraftName}
        onUrlChange={setDraftUrl}
        onSave={saveEditor}
        onCancel={() => setEditorOpen(false)}
        afterClose={() => {
          dialogOpenRef.current = false;
          showActiveWebview();
        }}
      />
    </div>
  );
}
