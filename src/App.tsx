import { useMemo, useState } from "react";
import { Tooltip, Typography } from "antd";
import {
  ApiOutlined,
  CodeOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  QrcodeOutlined,
  SettingOutlined,
  CloudServerOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import SshModule from "./modules/ssh/SshModule";
import ApiModule from "./modules/api/ApiModule";
import Placeholder from "./modules/Placeholder";
import SettingsModal from "./modules/SettingsModal";
import { useUiStore } from "./stores/uiStore";
import { useT } from "./i18n";
import { APP_VERSION } from "./version";

type ModuleKey = "ssh" | "json" | "qrcode" | "mysql" | "redis" | "api";

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
    icon: <CloudServerOutlined />,
    ready: true,
    featureKeys: [],
  },
  {
    key: "json",
    label: "JSON",
    titleKey: "JSON",
    descKey: "module.jsonDesc",
    icon: <FileTextOutlined />,
    ready: false,
    featureKeys: ["module.json.f1", "module.json.f2", "module.json.f3", "module.json.f4"],
  },
  {
    key: "qrcode",
    label: "QR",
    titleKey: "QR Code",
    descKey: "module.qrDesc",
    icon: <QrcodeOutlined />,
    ready: false,
    featureKeys: ["module.qr.f1", "module.qr.f2", "module.qr.f3", "module.qr.f4"],
  },
  {
    key: "mysql",
    label: "MySQL",
    titleKey: "MySQL",
    descKey: "module.mysqlDesc",
    icon: <DatabaseOutlined />,
    ready: false,
    featureKeys: ["module.mysql.f1", "module.mysql.f2", "module.mysql.f3", "module.mysql.f4"],
  },
  {
    key: "redis",
    label: "Redis",
    titleKey: "Redis",
    descKey: "module.redisDesc",
    icon: <CodeOutlined />,
    ready: false,
    featureKeys: ["module.redis.f1", "module.redis.f2", "module.redis.f3", "module.redis.f4"],
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
];

export default function App() {
  const [activeKey, setActiveKey] = useState<ModuleKey>("ssh");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lang = useUiStore((state) => state.lang);
  const showStatusBar = useUiStore((state) => state.showStatusBar);
  const t = useT(lang);

  const railLabel = (key: ModuleKey) =>
    key === "qrcode" ? t("module.qr") : t(`module.${key}`);

  const activeModule = useMemo(
    () => MODULES.find((item) => item.key === activeKey) ?? MODULES[0],
    [activeKey],
  );

  return (
    <div className="app">
      <aside className="rail">
        <div className="rail-logo" title="Yooso Toolbox">
          <span>YT</span>
        </div>
        <div className="rail-group">
          {MODULES.map((item) => (
            <Tooltip
              key={item.key}
              title={
                item.ready
                  ? item.titleKey
                  : `${item.titleKey} · ${t("module.planned")}`
              }
              placement="right"
              mouseEnterDelay={0.35}
            >
              <button
                type="button"
                className={`rail-btn${item.key === activeKey ? " active" : ""}`}
                onClick={() => setActiveKey(item.key)}
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
              className={`rail-btn${settingsOpen ? " active" : ""}`}
              onClick={() => setSettingsOpen(true)}
            >
              <span className="rail-icon">
                <SettingOutlined />
              </span>
              <span className="rail-label">{t("app.settings")}</span>
            </button>
          </Tooltip>
        </div>
      </aside>

      <main className="content">
        {/* 保持 SSH / API 常驻挂载：切到别的模块时只隐藏，避免终端被卸载导致连接断开 */}
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
        {activeModule.key !== "ssh" && activeModule.key !== "api" && (
          <Placeholder
            title={activeModule.titleKey}
            desc={t(activeModule.descKey)}
            icon={activeModule.icon}
            features={activeModule.featureKeys.map((key) => t(key))}
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

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
