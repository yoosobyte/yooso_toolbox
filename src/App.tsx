import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Tooltip, Typography } from "antd";
import {
  ApiOutlined,
  QrcodeOutlined,
  SettingOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import {
  AgentNavIcon,
  BrowserNavIcon,
  NoteNavIcon,
  SshNavIcon,
  TextNavIcon,
  TranslateNavIcon,
  FilesNavIcon,
} from "./components/NavIcons";
import type { ReactNode } from "react";
import SshModule from "./modules/ssh/SshModule";
import ApiModule from "./modules/api/ApiModule";
import QrModule from "./modules/qrcode/QrModule";
import TranslateModule from "./modules/translate/TranslateModule";
import TextModule from "./modules/text/TextModule";
import NoteModule from "./modules/note/NoteModule";
import FilesModule from "./modules/files/FilesModule";
import BrowserModule from "./modules/browser/BrowserModule";
import AiModule from "./modules/ai/AiModule";
import ToolsModule from "./modules/tools/ToolsModule";
import RedisModule from "./modules/redis/RedisModule";
import { RedisIcon } from "./modules/redis/icons";
import DbModule from "./modules/db/DbModule";
import Placeholder from "./modules/Placeholder";
import SettingsPage from "./modules/SettingsPage";
import VaultGate from "./VaultGate";
import { useUiStore } from "./stores/uiStore";
import { useApiStore } from "./stores/apiStore";
import { cleanupLegacyKeys } from "./storage";
import { useTerminalPrefs } from "./modules/ssh/terminalPrefs";
import type { ModuleKey } from "./modules/keys";
import { useT } from "./i18n";
import AppLogo from "./AppLogo";
import { APP_VERSION } from "./version";
import {DatabaseIcon} from "./modules/db/icons.tsx";



interface ModuleDef {
  key: ModuleKey;
  label: string;
  titleKey: string;
  descKey: string;
  icon: ReactNode;
  ready: boolean;
  featureKeys: string[];
}

const MODULES: ModuleDef[] = [
  {
    key: "ssh",
    label: "SSH",
    titleKey: "SSH / SFTP",
    descKey: "module.sshDesc",
    icon: <SshNavIcon />,
    ready: true,
    featureKeys: [],
  },
  {
    key: "text",
    label: "Text",
    titleKey: "Text",
    descKey: "module.textDesc",
    icon: <TextNavIcon />,
    ready: true,
    featureKeys: [],
  },
  {
    key: "note",
    label: "Note",
    titleKey: "Note",
    descKey: "module.noteDesc",
    icon: <NoteNavIcon />,
    ready: true,
    featureKeys: [],
  },
  {
    key: "files",
    label: "Files",
    titleKey: "Files",
    descKey: "module.filesDesc",
    icon: <FilesNavIcon />,
    ready: true,
    featureKeys: [],
  },
  {
    key: "qrcode",
    label: "QR",
    titleKey: "QR Code",
    descKey: "module.qrDesc",
    icon: <QrcodeOutlined />,
    ready: true,
    featureKeys: [],
  },
  {
    key: "db",
    label: "DB",
    titleKey: "DB",
    descKey: "module.dbDesc",
    icon: <DatabaseIcon />,
    ready: true,
    featureKeys: [],
  },
  {
    key: "redis",
    label: "Redis",
    titleKey: "Redis",
    descKey: "module.redisDesc",
    icon: <RedisIcon />,
    ready: true,
    featureKeys: [],
  },
  {
    key: "api",
    label: "API",
    titleKey: "API",
    descKey: "module.apiDesc",
    icon: <ApiOutlined />,
    ready: true,
    featureKeys: ["module.api.f1", "module.api.f2", "module.api.f3", "module.api.f4"],
  },
  {
    key: "translate",
    label: "Translate",
    titleKey: "Translation",
    descKey: "module.translateDesc",
    icon: <TranslateNavIcon />,
    ready: true,
    featureKeys: [],
  },
  {
    key: "browser",
    label: "Browser",
    titleKey: "Browser",
    descKey: "module.browserDesc",
    icon: <BrowserNavIcon />,
    ready: true,
    featureKeys: [],
  },
  {
    key: "ai",
    label: "AI",
    titleKey: "AI",
    descKey: "module.aiDesc",
    icon: <AgentNavIcon />,
    ready: true,
    featureKeys: [],
  },
  {
    key: "tools",
    label: "Tools",
    titleKey: "Tools",
    descKey: "module.toolsDesc",
    icon: <ToolOutlined />,
    ready: true,
    featureKeys: [],
  },
];

export default function App() {
  const [activeKey, setActiveKey] = useState<ModuleKey>(
    () => useUiStore.getState().defaultModule ?? "files",
  );
  const initializeApiStore = useApiStore((state) => state.init);
  const hydrateUi = useUiStore((state) => state.hydrate);

  useEffect(() => {
    void initializeApiStore();
    void hydrateUi();
    void cleanupLegacyKeys();
    void useTerminalPrefs.getState().hydrate();
  }, [initializeApiStore, hydrateUi]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingBrowserUrl, setPendingBrowserUrl] = useState<string | null>(null);

  /* 任意模块可以请求在内部浏览器打开链接 */
  useEffect(() => {
    const handler = (event: Event) => {
      const url = (event as CustomEvent<string>).detail;
      if (!url) return;
      setPendingBrowserUrl(url);
      setMounted((prev) => ({ ...prev, browser: true }));
      setActiveKey("browser");
    };
    window.addEventListener("yooso:open-browser", handler as EventListener);
    return () =>
      window.removeEventListener("yooso:open-browser", handler as EventListener);
  }, []);
  // 头部模块（SSH / API）常驻；其余模块首次打开后再保持挂载，避免一启动就请求外网/占用资源
  const [mounted, setMounted] = useState<Partial<Record<ModuleKey, boolean>>>(() => {
    const initial: Partial<Record<ModuleKey, boolean>> = {
      ssh: true,
      api: true,
      db: true,
    };
    // 默认打开的模块也要在启动时挂载，否则会显示空白
    const defaultModule = useUiStore.getState().defaultModule;
    if (defaultModule) initial[defaultModule] = true;
    return initial;
  });
  const lang = useUiStore((state) => state.lang);
  const showStatusBar = useUiStore((state) => state.showStatusBar);
  const t = useT(lang);

  /** 设置页里的链接：浏览器模块可见时用内部浏览器打开 */
  const openInBrowser = (url: string) => {
    if (hiddenModules.includes("browser")) {
      void openUrl(url).catch(() => undefined);
      return;
    }
    setPendingBrowserUrl(url);
    setSettingsOpen(false);
    activate("browser");
  };

  const activate = (key: ModuleKey) => {
    // 切换模块时关闭设置页
    setSettingsOpen(false);
    setActiveKey(key);
    setMounted((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  };

  const railLabel = (key: ModuleKey) => {
    if (key === "qrcode") return t("module.qr");
    return t(`module.${key}`);
  };

  const activeModule = useMemo(
    () => MODULES.find((item) => item.key === activeKey) ?? MODULES[0],
    [activeKey],
  );

  const moduleOrder = useUiStore((state) => state.moduleOrder);
  const hiddenModules = useUiStore((state) => state.hiddenModules);
  const sortedModules = useMemo(() => {
    // 去重并补齐缺失模块，避免本地旧的排序数据导致重复 / 丢项
    const seen = new Set<ModuleKey>();
    const list: ModuleDef[] = [];
    for (const key of moduleOrder) {
      if (seen.has(key)) continue;
      const def = MODULES.find((item) => item.key === key);
      if (def) {
        seen.add(key);
        list.push(def);
      }
    }
    for (const def of MODULES) {
      if (!seen.has(def.key)) list.push(def);
    }
    return list.filter((item) => !hiddenModules.includes(item.key));
  }, [moduleOrder, hiddenModules]);

  /**
   * 左侧模块栏的键盘导航：Tab / 上下方向键直接在模块间切换（首尾循环），
   * 不是只移动焦点 —— 选中的同时就切过去。
   */
  const stepRail = (step: 1 | -1) => {
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".rail .rail-btn"),
    );
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      current < 0 ? 0 : (current + step + buttons.length) % buttons.length;
    const next = buttons[nextIndex];
    if (!next) return;
    const key = next.dataset.module as ModuleKey | undefined;
    if (key) activate(key);
    else if (next.dataset.settings !== undefined) setSettingsOpen(true);
    next.focus();
  };

  const handleRailKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest(".rail-btn")) return;
    if (event.key === "Tab") {
      // 在模块栏内部循环，不跳出去
      event.preventDefault();
      stepRail(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      stepRail(1);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      stepRail(-1);
    }
  };

  return (
    <VaultGate>
    <div className={`app${showStatusBar ? "" : " no-statusbar"}`}>
      <aside className="rail" onKeyDown={handleRailKeyDown}>
        <div className="rail-logo" title="悦盒">
          <AppLogo />
        </div>
        <div className="rail-group">
          {sortedModules.map((item) => (
            <Tooltip
              key={item.key}
              title={
                item.ready
                  ? item.key === "db" ||
                    item.key === "note" ||
                    item.key === "browser" ||
                    item.key === "ai" ||
                    item.key === "tools"
                    ? t(`module.${item.key}`)
                    : item.titleKey
                  : `${item.titleKey} · ${t("module.planned")}`
              }
              placement="right"
              mouseEnterDelay={0.35}
            >
              <button
                type="button"
                data-module={item.key}
                className={`rail-btn${item.key === activeKey ? " active" : ""}`}
                onClick={(event) => {
                  // WebKit 里点击按钮默认不聚焦，手动聚焦一下，点完就能用 Tab / 方向键继续切
                  event.currentTarget.focus();
                  activate(item.key);
                }}
              >
                <span className="rail-icon">{item.icon}</span>
                <span className="rail-label">
                  {railLabel(item.key)}
                </span>
                {!item.ready && <span className="rail-dot" />}
              </button>
            </Tooltip>
          ))}
        </div>
        <div className="rail-group bottom">
          <Tooltip title={t("app.settings")} placement="right" mouseEnterDelay={0.35}>
            <button
              type="button"
              data-settings=""
              className={`rail-btn${settingsOpen ? " active" : ""}`}
              onClick={(event) => {
                event.currentTarget.focus();
                setSettingsOpen(true);
              }}
            >
              <span className="rail-icon">
                <SettingOutlined />
              </span>
              <span className="rail-label">{t("app.settings")}</span>
            </button>
          </Tooltip>
        </div>
      </aside>

      <main className={`content${settingsOpen ? " settings-open" : ""}`}>
        {/* 保持常用模块常驻挂载：切走时只隐藏，避免终端断开、请求状态丢失、翻译页被重载 */}
        <div
          className="module-slot"
          style={{ display: activeModule.key === "ssh" ? "flex" : "none" }}
        >
          <SshModule />
        </div>
        <div
          className="module-slot"
          style={{ display: activeModule.key === "api" ? "flex" : "none" }}
        >
          <ApiModule />
        </div>
        {mounted.text && (
          <div
            className="module-slot"
            style={{ display: activeModule.key === "text" ? "flex" : "none" }}
          >
            <TextModule />
          </div>
        )}
        {mounted.note && (
          <div
            className="module-slot"
            style={{ display: activeModule.key === "note" ? "flex" : "none" }}
          >
            <NoteModule />
          </div>
        )}
        {mounted.files && (
          <div
            className="module-slot"
            style={{ display: activeModule.key === "files" ? "flex" : "none" }}
          >
            <FilesModule />
          </div>
        )}
        {mounted.redis && (
          <div
            className="module-slot"
            style={{ display: activeModule.key === "redis" ? "flex" : "none" }}
          >
            <RedisModule />
          </div>
        )}
        {mounted.db && (
          <div
            className="module-slot"
            style={{ display: activeModule.key === "db" ? "flex" : "none" }}
          >
            <DbModule />
          </div>
        )}
        {mounted.qrcode && (
          <div
            className="module-slot"
            style={{ display: activeModule.key === "qrcode" ? "flex" : "none" }}
          >
            <QrModule />
          </div>
        )}
        {mounted.translate && (
          <div
            className="module-slot"
            style={{ display: activeModule.key === "translate" ? "flex" : "none" }}
          >
            <TranslateModule />
          </div>
        )}
        {mounted.browser && (
          <div
            className="module-slot"
            style={{ display: activeModule.key === "browser" ? "flex" : "none" }}
          >
            <BrowserModule
              obscured={settingsOpen}
              pendingUrl={pendingBrowserUrl}
              onConsumed={() => setPendingBrowserUrl(null)}
            />
          </div>
        )}
        {mounted.ai && (
          <div
            className="module-slot"
            style={{ display: activeModule.key === "ai" ? "flex" : "none" }}
          >
            <AiModule />
          </div>
        )}
        {mounted.tools && (
          <div
            className="module-slot"
            style={{ display: activeModule.key === "tools" ? "flex" : "none" }}
          >
            <ToolsModule />
          </div>
        )}
        {!["ssh", "api", "text", "note", "files", "qrcode", "translate", "browser", "ai", "tools", "redis", "db"].includes(activeModule.key) && (
          <Placeholder
            title={activeModule.titleKey}
            desc={t(activeModule.descKey)}
            icon={activeModule.icon}
            features={activeModule.featureKeys.map((key) => t(key))}
          />
        )}
        {settingsOpen && (
          <SettingsPage
            onClose={() => setSettingsOpen(false)}
            onOpenUrl={openInBrowser}
          />
        )}
      </main>

      {showStatusBar && (
        <footer className="statusbar">
          <span className="status-dot" />
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {t("app.status", { version: APP_VERSION })}
          </Typography.Text>
          <span style={{ flex: 1 }} />
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {t("app.phase")}
          </Typography.Text>
        </footer>
      )}

    </div>
    </VaultGate>
  );
}
