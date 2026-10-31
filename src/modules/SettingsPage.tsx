import { useEffect, useRef, useState } from "react";
import {
  App as AntdApp,
  Button,
  Checkbox,
  Divider,
  InputNumber,
  Modal,
  Radio,
  Segmented,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  AntDesignOutlined,
  ApiOutlined,
  AppstoreOutlined,
  CheckCircleOutlined,
  CloudDownloadOutlined,
  GithubOutlined,
  GlobalOutlined,
  HolderOutlined,
  LayoutOutlined,
  LoadingOutlined,
  SaveOutlined,
  UploadOutlined,
  ReloadOutlined,
  SafetyOutlined,
  SettingOutlined,
  SkinOutlined,
} from "@ant-design/icons";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkUpdate, configExport } from "../api";
import { importBackupFile, pickBackupFile, reloadApp } from "../backup";
import type { UpdateInfo } from "../types";
import {
  API_TIMEOUT_MAX_SECS,
  API_TIMEOUT_MIN_SECS,
  DEFAULT_API_TIMEOUT_SECS,
  useUiStore,
} from "../stores/uiStore";
import yoosoLogo from "../assets/yoosobyte.png";
import type { ThemeSetting } from "../stores/uiStore";
import type { LangSetting } from "../i18n";
import { useT } from "../i18n";
import { APP_VERSION } from "../version";
import AppLogo from "../AppLogo";
import { errText } from "../utils";

interface Props {
  onClose: () => void;
  /** 在内部浏览器打开链接（未提供时退回系统浏览器） */
  onOpenUrl?: (url: string) => void;
}

const GITHUB_URL = "https://www.github.com/yoosobyte/";
const SITE_URL = "https://www.yoosobyte.com";
const TAURI_URL = "https://v2.tauri.app";
const REACT_URL = "https://react.dev";
const ANTD_URL = "https://ant.design";
const RUST_URL = "https://www.rust-lang.org";

export default function SettingsPage({ onClose, onOpenUrl }: Props) {
  const lang = useUiStore((state) => state.lang);
  const language = useUiStore((state) => state.language);
  const theme = useUiStore((state) => state.theme);
  const showStatusBar = useUiStore((state) => state.showStatusBar);
  const setLanguage = useUiStore((state) => state.setLanguage);
  const setTheme = useUiStore((state) => state.setTheme);
  const setShowStatusBar = useUiStore((state) => state.setShowStatusBar);
  const apiTimeoutSecs = useUiStore((state) => state.apiTimeoutSecs);
  const setApiTimeoutSecs = useUiStore((state) => state.setApiTimeoutSecs);
  const defaultModule = useUiStore((state) => state.defaultModule);
  const setDefaultModule = useUiStore((state) => state.setDefaultModule);
  const t = useT(lang);
  const { message, modal } = AntdApp.useApp();

  const moduleOrder = useUiStore((state) => state.moduleOrder);
  const hiddenModules = useUiStore((state) => state.hiddenModules);
  const setModuleVisible = useUiStore((state) => state.setModuleVisible);
  const resetModules = useUiStore((state) => state.resetModules);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportItems, setExportItems] = useState<string[]>([
    "db",
    "redis",
    "sessions",
    "ai.apiKey",
    "notes",
    "browser.sites",
    "db.queries",
    "api.state",
    "ui",
  ]);
  const [busyBackup, setBusyBackup] = useState(false);
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      const result = await checkUpdate();
      setInfo(result);
    } catch (err) {
      setInfo(null);
      setError(errText(err));
    } finally {
      setChecking(false);
    }
  };

  const exportOptions = [
    { value: "db", label: t("backup.db") },
    { value: "redis", label: t("backup.redis") },
    { value: "sessions", label: t("backup.sessions") },
    { value: "ai.apiKey", label: t("backup.apiKey") },
    { value: "notes", label: t("backup.notes") },
    { value: "browser.sites", label: t("backup.sites") },
    { value: "db.queries", label: t("backup.queries") },
    { value: "api.state", label: t("backup.apiHistory") },
    { value: "ui", label: t("backup.ui") },
  ];

  const runExport = async () => {
    const target = await saveDialog({
      defaultPath: `yooso-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof target !== "string") return;
    const secretKeys = exportItems.filter(
      (key) => !["db", "redis", "sessions", "ui"].includes(key),
    );
    // 界面布局（模块顺序、侧栏宽度等）存在加密库
    if (exportItems.includes("ui") && !secretKeys.includes("ui.layout")) {
      secretKeys.push("ui.layout");
    }
    const ui = exportItems.includes("ui")
      ? localStorage.getItem("yooso.ui")
      : null;
    setBusyBackup(true);
    try {
      await configExport(
        target,
        {
          sessions: exportItems.includes("sessions"),
          redis: exportItems.includes("redis"),
          db: exportItems.includes("db"),
          secrets: secretKeys,
          ui: exportItems.includes("ui"),
        },
        ui,
      );
      setExportOpen(false);
      message.success(t("backup.exported"));
    } catch (error) {
      message.error(errText(error));
    } finally {
      setBusyBackup(false);
    }
  };

  const runImport = async () => {
    const source = await pickBackupFile();
    if (!source) return;
    modal.confirm({
      title: t("backup.import"),
      content: t("backup.importConfirm"),
      okText: t("backup.import"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await importBackupFile(source);
          message.success(t("backup.imported"));
          reloadApp();
        } catch (error) {
          message.error(errText(error));
        }
      },
    });
  };

  const openLink = async (url: string) => {
    if (onOpenUrl) {
      onOpenUrl(url);
      return;
    }
    try {
      await openUrl(url);
    } catch (err) {
      message.error(errText(err));
    }
  };

  const [ghost, setGhost] = useState<{
    top: number;
    left: number;
    width: number;
    label: string;
    desc: string;
  } | null>(null);
  const dragMeta = useRef<{ key: string; offsetY: number } | null>(null);

  const startDrag = (
    event: React.MouseEvent<HTMLDivElement>,
    key: string,
  ) => {
    if ((event.target as HTMLElement).closest(".module-manage-controls")) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    dragMeta.current = { key, offsetY: event.clientY - rect.top };
    setDragKey(key);
    setGhost({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      label: key === "qrcode" ? t("module.qr") : t(`module.${key}`),
      desc: t(key === "qrcode" ? "module.qrDesc" : `module.${key}Desc`),
    });
  };

  useEffect(() => {
    if (!dragKey) return;
    const onMove = (event: MouseEvent) => {
      const meta = dragMeta.current;
      if (!meta) return;
      setGhost((prev) =>
        prev ? { ...prev, top: event.clientY - meta.offsetY } : prev,
      );
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".module-manage-row"),
      );
      const target = rows.find((row) => {
        const rect = row.getBoundingClientRect();
        return event.clientY >= rect.top && event.clientY <= rect.bottom;
      });
      const targetKey = target?.dataset.key;
      if (!targetKey || targetKey === meta.key) return;
      const order = useUiStore.getState().moduleOrder;
      const from = order.indexOf(meta.key as never);
      const to = order.indexOf(targetKey as never);
      if (from < 0 || to < 0 || from === to) return;
      const next = [...order];
      next.splice(from, 1);
      next.splice(to, 0, meta.key as never);
      useUiStore.getState().setModuleOrder(next);
    };
    const onUp = () => {
      setDragKey(null);
      setGhost(null);
      dragMeta.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragKey]);

  return (
    <div className="module settings-page">
      <header className="module-head">
        <span className="module-icon">
          <SettingOutlined />
        </span>
        <div>
          <Typography.Text strong style={{ fontSize: 14 }}>
            {t("settings.title")}
          </Typography.Text>
          <div className="module-desc">{t("settings.desc")}</div>
        </div>
        <span style={{ flex: 1 }} />
        <Button type="primary" size="small" onClick={onClose}>
          {t("settings.saveBack")}
        </Button>
      </header>
      <div className="settings-body settings-scroll">
        {/* 模块管理 */}
        <section className="settings-block">
          <div className="settings-label">
            <AppstoreOutlined /> {t("settings.modules")}
            <Button size="small" onClick={resetModules}>
              {t("settings.resetModules")}
            </Button>
            <Typography.Text type="secondary" className="settings-hint">
              {t("settings.modulesHint")}
            </Typography.Text>
          </div>
          <div className="module-manage">
            {moduleOrder.map((key) => {
              const visible = !hiddenModules.includes(key);
              return (
                <div
                  key={key}
                  data-key={key}
                  className={`module-manage-row${dragKey === key ? " dragging" : ""}`}
                  onMouseDown={(event) => startDrag(event, key)}
                >
                  <HolderOutlined className="module-manage-handle" />
                  <span className="module-manage-name">
                    {key === "qrcode" ? t("module.qr") : t(`module.${key}`)}
                  </span>
                  <span className="module-manage-desc">
                    {t(key === "qrcode" ? "module.qrDesc" : `module.${key}Desc`)}
                  </span>
                  <div className="module-manage-controls">
                    <Radio
                      checked={defaultModule === key}
                      disabled={!visible}
                      onChange={() => setDefaultModule(key)}
                    >
                      {t("settings.defaultShort")}
                    </Radio>
                    <Switch
                      size="small"
                      checked={visible}
                      disabled={defaultModule === key}
                      onChange={(checked) => setModuleVisible(key, checked)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <Divider style={{ margin: "14px 0" }} />

        {/* 语言 */}
        <section className="settings-row">
          <div className="settings-label">
            <GlobalOutlined /> {t("settings.language")}
            <Typography.Text type="secondary" className="settings-hint">
              {t("settings.languageHint")}
            </Typography.Text>
          </div>
          <Segmented
            value={language}
            onChange={(value) => setLanguage(value as LangSetting)}
            options={[
              { label: t("common.system"), value: "system" },
              { label: "中文", value: "zh" },
              { label: "English", value: "en" },
            ]}
          />
        </section>

        {/* 主题 */}
        <section className="settings-row">
          <div className="settings-label">
            <SkinOutlined /> {t("settings.theme")}
            <Typography.Text type="secondary" className="settings-hint">
              {t("settings.themeHint")}
            </Typography.Text>
          </div>
          <Segmented
            value={theme}
            onChange={(value) => setTheme(value as ThemeSetting)}
            options={[
              { label: t("common.system"), value: "system" },
              { label: t("settings.themeLight"), value: "light" },
              { label: t("settings.themeDark"), value: "dark" },
            ]}
          />
        </section>

        {/* 底部状态栏开关 */}
        <section className="settings-row">
          <div className="settings-label">
            <LayoutOutlined /> {t("settings.showStatusBar")}
            <Typography.Text type="secondary" className="settings-hint">
              {t("settings.showStatusBarHint")}
            </Typography.Text>
          </div>
          <Switch checked={showStatusBar} onChange={setShowStatusBar} />
        </section>

        {/* API 调试请求超时 */}
        <section className="settings-row">
          <div className="settings-label">
            <ApiOutlined /> {t("settings.apiTimeout")}
            <Typography.Text type="secondary" className="settings-hint">
              {t("settings.apiTimeoutHint")}
            </Typography.Text>
          </div>
          <InputNumber
            min={API_TIMEOUT_MIN_SECS}
            max={API_TIMEOUT_MAX_SECS}
            step={1}
            precision={0}
            value={apiTimeoutSecs}
            onChange={(value) =>
              setApiTimeoutSecs(value ?? DEFAULT_API_TIMEOUT_SECS)
            }
            addonAfter={t("settings.apiTimeoutUnit")}
            style={{ width: 132 }}
          />
        </section>

        <Divider style={{ margin: "14px 0" }} />

        {/* 升级 */}
        <section className="settings-block">
          <div className="settings-label">
            <CloudDownloadOutlined /> {t("settings.update")}
            <Tag className="settings-version">v{APP_VERSION}</Tag>
            <span style={{ flex: 1 }} />
            <Button
              size="small"
              icon={checking ? <LoadingOutlined /> : <ReloadOutlined />}
              loading={checking}
              onClick={() => void runCheck()}
            >
              {checking ? t("settings.checking") : t("settings.checkUpdate")}
            </Button>
          </div>

          {info && (
            <div className="settings-update-result">
              {info.hasUpdate ? (
                <>
                  <Typography.Text>
                    {t("settings.newVersion", {
                      latest: info.latest,
                      current: info.current,
                    })}
                  </Typography.Text>
                  {info.notes ? (
                    <div className="settings-update-notes">
                      <Typography.Text
                        type="secondary"
                        className="settings-update-notes-title"
                      >
                        {t("settings.updateNotes")}
                      </Typography.Text>
                      <div className="settings-update-notes-body">{info.notes}</div>
                    </div>
                  ) : null}
                  <Space size={6}>
                    <Button
                      size="small"
                      type="primary"
                      icon={<CloudDownloadOutlined />}
                      onClick={() => void openLink(info.url)}
                    >
                      {t("settings.download")}
                    </Button>
                    <Typography.Text type="secondary" className="settings-url">
                      {info.url}
                    </Typography.Text>
                  </Space>
                </>
              ) : (
                <Typography.Text type="secondary">
                  <CheckCircleOutlined style={{ color: "var(--success)" }} />{" "}
                  {t("settings.upToDate", { version: info.current })}
                </Typography.Text>
              )}
            </div>
          )}

          {error && (
            <div className="settings-update-result">
              <Typography.Text type="danger">
                {t("settings.updateFailed", { error })}
              </Typography.Text>
            </div>
          )}
        </section>

        <Divider style={{ margin: "14px 0" }} />

        {/* 凭据库 */}
        <section className="settings-block">
          <div className="settings-label">
            <SafetyOutlined /> {t("settings.vault")}
          </div>
          <Typography.Text type="secondary" className="settings-hint">
            {t("settings.vaultAuto")}
          </Typography.Text>
          <div className="settings-backup">
            <Button
              size="small"
              icon={<SaveOutlined />}
              onClick={() => setExportOpen(true)}
            >
              {t("backup.export")}
            </Button>
            <Button
              size="small"
              icon={<UploadOutlined />}
              onClick={() => void runImport()}
            >
              {t("backup.import")}
            </Button>
          </div>
          <Typography.Text type="secondary" className="settings-hint">
            {t("backup.desc")}
          </Typography.Text>
        </section>

        <Divider style={{ margin: "14px 0" }} />

        {/* 关于 */}
        <section className="settings-block">
          <div className="settings-label">
            <GithubOutlined /> {t("settings.about")}
          </div>
          <div className="about-card">
            <div className="about-brand">
              <span className="about-logo">
                <AppLogo />
              </span>
              <div className="about-brand-text">
                <div className="about-title">
                  悦盒
                  <span className="about-version">v{APP_VERSION}</span>
                </div>
                <div className="about-subtitle">
                  {t("settings.aboutCompany")} · {t("settings.aboutSlogan")}
                </div>
              </div>
            </div>
            <div className="about-badges">
              <Tooltip title="github.com/yoosobyte">
                <button
                  type="button"
                  className="about-badge"
                  onClick={() => void openLink(GITHUB_URL)}
                >
                  <GithubOutlined />
                </button>
              </Tooltip>
              <Tooltip title="www.yoosobyte.com">
                <button
                  type="button"
                  className="about-badge about-badge-logo"
                  onClick={() => void openLink(SITE_URL)}
                >
                  <img src={yoosoLogo} alt="yoosoByte" />
                </button>
              </Tooltip>
              <Tooltip title="Tauri 2">
                <button
                  type="button"
                  className="about-badge"
                  onClick={() => void openLink(TAURI_URL)}
                >
                  <svg viewBox="0 0 24 24" width={24} height={24} aria-hidden="true">
                    <path
                      d="M3.5 8.5A5 5 0 0 1 8.5 3.5H16v4H8.5a1 1 0 0 0-1 1V16h-4z"
                      fill="#ffc131"
                    />
                    <path
                      d="M20.5 15.5a5 5 0 0 1-5 5H8v-4h7.5a1 1 0 0 0 1-1V8h4z"
                      fill="#24c8db"
                    />
                  </svg>
                </button>
              </Tooltip>
              <Tooltip title="React 19">
                <button
                  type="button"
                  className="about-badge"
                  onClick={() => void openLink(REACT_URL)}
                >
                  <svg viewBox="-11.5 -10.23 23 20.46" width={25} height={25} aria-hidden="true">
                    <circle r="2.05" fill="#61dafb" />
                    <g stroke="#61dafb" strokeWidth="1" fill="none">
                      <ellipse rx="11" ry="4.2" />
                      <ellipse rx="11" ry="4.2" transform="rotate(60)" />
                      <ellipse rx="11" ry="4.2" transform="rotate(120)" />
                    </g>
                  </svg>
                </button>
              </Tooltip>
              <Tooltip title="Ant Design 6">
                <button
                  type="button"
                  className="about-badge"
                  onClick={() => void openLink(ANTD_URL)}
                >
                  <AntDesignOutlined />
                </button>
              </Tooltip>
              <Tooltip title="Rust">
                <button
                  type="button"
                  className="about-badge"
                  onClick={() => void openLink(RUST_URL)}
                >
                  <svg viewBox="0 0 24 24" width={24} height={24} aria-hidden="true">
                    <circle cx="12" cy="12" r="9.2" fill="none" stroke="#CE422B" strokeWidth="3" strokeDasharray="2.1 2.3" />
                    <circle cx="12" cy="12" r="6.4" fill="#CE422B" />
                    <path
                      d="M9.4 16.2V7.8h3.1a2.6 2.6 0 0 1 1.7.6 2.1 2.1 0 0 1 .6 1.6 2.2 2.2 0 0 1-1.1 1.9 2.3 2.3 0 0 1 1 1l1 3.3h-1.7l-.9-3h-2.1v3zm1.6-4.4h1.5a1.1 1.1 0 0 0 1.2-1.2 1.1 1.1 0 0 0-1.2-1.2h-1.5z"
                      fill="#fff"
                    />
                  </svg>
                </button>
              </Tooltip>
            </div>
          </div>
        </section>
      </div>
      {ghost && (
        <div
          className="module-manage-ghost"
          style={{ top: ghost.top, left: ghost.left, width: ghost.width }}
        >
          <HolderOutlined className="module-manage-handle" />
          <span className="module-manage-name">{ghost.label}</span>
          <span className="module-manage-desc">{ghost.desc}</span>
          <div className="module-manage-controls" style={{ visibility: "hidden" }}>
            <Radio checked={false} disabled>
              {t("settings.defaultShort")}
            </Radio>
            <Switch size="small" checked={false} disabled />
          </div>
        </div>
      )}

      <Modal
        open={exportOpen}
        title={t("backup.pickItems")}
        okText={t("backup.export")}
        cancelText={t("common.cancel")}
        confirmLoading={busyBackup}
        onOk={() => void runExport()}
        onCancel={() => setExportOpen(false)}
      >
        <Checkbox.Group
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
          value={exportItems}
          onChange={(values) => setExportItems(values as string[])}
          options={exportOptions}
        />
      </Modal>
    </div>
  );
}
