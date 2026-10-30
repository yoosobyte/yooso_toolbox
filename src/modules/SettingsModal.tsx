import { useState } from "react";
import {
  App as AntdApp,
  Button,
  Divider,
  Modal,
  Segmented,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import {
  CheckCircleOutlined,
  CloudDownloadOutlined,
  GithubOutlined,
  GlobalOutlined,
  LayoutOutlined,
  LoadingOutlined,
  ReloadOutlined,
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
  open: boolean;
  onClose: () => void;
}

const GITHUB_URL = "https://www.github.com/yoosobyte/";
const SITE_URL = "https://www.yoosobyte.com";

export default function SettingsModal({ open, onClose }: Props) {
  const lang = useUiStore((state) => state.lang);
  const language = useUiStore((state) => state.language);
  const theme = useUiStore((state) => state.theme);
  const showStatusBar = useUiStore((state) => state.showStatusBar);
  const setLanguage = useUiStore((state) => state.setLanguage);
  const setTheme = useUiStore((state) => state.setTheme);
  const setShowStatusBar = useUiStore((state) => state.setShowStatusBar);
  const t = useT(lang);
  const { message } = AntdApp.useApp();

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
    try {
      await openUrl(url);
    } catch (err) {
      message.error(errText(err));
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={620}
      title={t("settings.title")}
      destroyOnClose
      styles={{ body: { maxHeight: "calc(100vh - 160px)", overflowY: "auto" } }}
    >
      <div className="settings-body">
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
                  Yooso Toolbox
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
    </Modal>
  );
}
