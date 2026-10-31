import { useEffect, useState } from "react";
import { App as AntdApp, Button, Segmented, Tooltip, Typography } from "antd";
import {
  ExportOutlined,
  GlobalOutlined,
  LinkOutlined,
  LoadingOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useUiStore } from "../../stores/uiStore";
import { TranslateNavIcon } from "../../components/NavIcons";
import { useT } from "../../i18n";
import { copyText } from "../../clipboard";
import { errText } from "../../utils";
import QuickTranslate from "./QuickTranslate";
import type { TranslateLine } from "./api";
import { loadStored, migrateStored, saveStored } from "../../storage";

type Tab = "quick" | "web";

const URLS: Record<TranslateLine, string> = {
  intl: "https://www.bing.com/translator",
  cn: "https://cn.bing.com/translator",
};

const STORE_KEY = "yooso.translate.line";
const LOAD_TIMEOUT = 15000;

export default function TranslateModule() {
  const t = useT(useUiStore((state) => state.lang));
  const { message } = AntdApp.useApp();

  const [tab, setTab] = useState<Tab>("quick");
  const [webMounted, setWebMounted] = useState(false);
  const [line, setLine] = useState<TranslateLine>("intl");
  const [seq, setSeq] = useState(0);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);

  const src = URLS[line];

  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), LOAD_TIMEOUT);
    return () => window.clearTimeout(timer);
  }, [loading, seq, line]);

  /* 上次使用的翻译线路：存在后端凭据库（旧 localStorage 自动迁移） */
  useEffect(() => {
    let alive = true;
    void (async () => {
      await migrateStored(STORE_KEY, "translate.line");
      const raw = await loadStored("translate.line");
      if (!alive) return;
      if (raw === "cn" || raw === "intl") setLine(raw);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const switchLine = (next: TranslateLine) => {
    if (next === line) return;
    setLine(next);
    setLoading(true);
    setSlow(false);
    void saveStored("translate.line", next);
  };

  const openWeb = () => {
    setWebMounted(true);
    setTab("web");
  };

  const reload = () => {
    setLoading(true);
    setSlow(false);
    setSeq((value) => value + 1);
  };

  const openInBrowser = () => {
    void openUrl(src).catch((error) => message.error(errText(error)));
  };

  const copyLink = () => {
    void copyText(src).then(
      () => message.success(t("translate.copied")),
      () => message.error(t("common.copyFailed")),
    );
  };

  return (
    <div className="module tr-module">
      <header className="module-head">
        <span className="module-icon">
          <TranslateNavIcon />
        </span>
        <div>
          <Typography.Text strong style={{ fontSize: 14 }}>
            {t("module.translate")}
          </Typography.Text>
          <div className="module-desc">{t("module.translateDesc")}</div>
        </div>
        <span style={{ flex: 1 }} />
        <Segmented
          value={tab}
          onChange={(value) => {
            const next = value as Tab;
            if (next === "web") setWebMounted(true);
            setTab(next);
          }}
          options={[
            {
              value: "quick",
              label: (
                <span className="tr-tab-label">
                  <ThunderboltOutlined /> {t("translate.tabQuick")}
                </span>
              ),
            },
            {
              value: "web",
              label: (
                <span className="tr-tab-label">
                  <GlobalOutlined /> {t("translate.tabWeb")}
                </span>
              ),
            },
          ]}
        />
      </header>

      <div
        className="tr-slot"
        style={{ display: tab === "quick" ? "flex" : "none" }}
      >
        <QuickTranslate line={line} onLineChange={switchLine} onOpenWeb={openWeb} />
      </div>

      {webMounted && (
        <div className="tr-slot" style={{ display: tab === "web" ? "flex" : "none" }}>
          <div className="tr-bar">
            <span className="tr-bar-label">{t("translate.line")}</span>
            <Segmented
              size="small"
              value={line}
              onChange={(value) => switchLine(value as TranslateLine)}
              options={[
                { value: "intl", label: t("translate.intl") },
                { value: "cn", label: t("translate.cn") },
              ]}
            />
            <Tooltip title={t("translate.refresh")}>
              <Button size="small" type="text" icon={<ReloadOutlined />} onClick={reload}>
                {t("common.refresh")}
              </Button>
            </Tooltip>
            <span style={{ flex: 1 }} />
            <Button size="small" icon={<LinkOutlined />} onClick={copyLink}>
              {t("translate.copyLink")}
            </Button>
            <Button size="small" icon={<ExportOutlined />} onClick={openInBrowser}>
              {t("translate.openBrowser")}
            </Button>
          </div>

          <div className="tr-frame-wrap">
            <iframe
              key={`${line}-${seq}`}
              className="tr-frame"
              title={t("translate.frameTitle")}
              src={src}
              referrerPolicy="no-referrer-when-downgrade"
              allow="clipboard-read; clipboard-write"
              onLoad={() => {
                setLoading(false);
                setSlow(false);
              }}
            />
            {loading && (
              <div className="tr-loading">
                <LoadingOutlined spin className="tr-loading-icon" />
                <div className="tr-loading-text">
                  {slow ? t("translate.loadFail") : t("translate.loading")}
                </div>
                {slow && (
                  <Button size="small" type="primary" onClick={openInBrowser}>
                    {t("translate.openBrowser")}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="tr-foot">
            <span className="tr-hint">{t("translate.hint")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
