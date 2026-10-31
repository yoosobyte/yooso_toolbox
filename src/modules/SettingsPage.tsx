import { useEffect, useRef, useState } from "react";
import {
  App as AntdApp,
  Button,
  Divider,
  Radio,
  Segmented,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  CloudDownloadOutlined,
  GithubOutlined,
  GlobalOutlined,
  HolderOutlined,
  LayoutOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SettingOutlined,
  SkinOutlined,
} from "@ant-design/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkUpdate } from "../api";
import type { UpdateInfo } from "../types";
import { useUiStore } from "../stores/uiStore";
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

export default function SettingsPage({ onClose, onOpenUrl }: Props) {
  const lang = useUiStore((state) => state.lang);
  const language = useUiStore((state) => state.language);
  const theme = useUiStore((state) => state.theme);
  const showStatusBar = useUiStore((state) => state.showStatusBar);
  const setLanguage = useUiStore((state) => state.setLanguage);
  const setTheme = useUiStore((state) => state.setTheme);
  const setShowStatusBar = useUiStore((state) => state.setShowStatusBar);
  const defaultModule = useUiStore((state) => state.defaultModule);
  const setDefaultModule = useUiStore((state) => state.setDefaultModule);
  const t = useT(lang);
  const { message } = AntdApp.useApp();

  const moduleOrder = useUiStore((state) => state.moduleOrder);
  const hiddenModules = useUiStore((state) => state.hiddenModules);
  const setModuleVisible = useUiStore((state) => state.setModuleVisible);
  const resetModules = useUiStore((state) => state.resetModules);
  const [dragKey, setDragKey] = useState<string | null>(null);
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
            <Button
              className="about-link"
              size="small"
              icon={<GithubOutlined />}
              onClick={() => void openLink(GITHUB_URL)}
            >
              github.com/yoosobyte
            </Button>
            <Button
              className="about-link"
              size="small"
              icon={<GlobalOutlined />}
              onClick={() => void openLink(SITE_URL)}
            >
              www.yoosobyte.com
            </Button>
            <div className="about-tech">{t("settings.aboutTech")}</div>
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
    </div>
  );
}
