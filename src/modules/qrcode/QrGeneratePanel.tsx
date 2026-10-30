import { useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { App as AntdApp, Button, Input, Select, Slider, Tooltip, Typography } from "antd";
import {
  ClearOutlined,
  CodeOutlined,
  DownloadOutlined,
  FileImageOutlined,
  PictureOutlined,
  QrcodeOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText, basename } from "../../utils";
import { saveDataUrl, saveText } from "../../save";
import {
  buildMatrix,
  drawQr,
  loadImageElement,
  qrSvg,
  type EcLevel,
  type QrLogo,
  type QrMatrix,
  type QrOptions,
} from "./qrRender";

const EC_LEVELS: { value: EcLevel; label: string }[] = [
  { value: "L", label: "L · 7%" },
  { value: "M", label: "M · 15%" },
  { value: "Q", label: "Q · 25%" },
  { value: "H", label: "H · 30%" },
];

const MARGIN_OPTIONS = [0, 1, 2, 3, 4, 6, 8].map((value) => ({
  value,
  label: `${value}`,
}));

const PNG_SIZES = [256, 512, 768, 1024, 1536];

type Preview =
  | { status: "empty" }
  | { status: "error"; raw: string }
  | { status: "ok"; matrix: QrMatrix; svg: string };

interface Props {
  content: string;
  onContentChange: (value: string) => void;
}

function looksTooLong(message: string): boolean {
  return /too (big|long)|overflow|data too long/i.test(message);
}

export default function QrGeneratePanel({ content, onContentChange }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const { message } = AntdApp.useApp();

  const [ecLevel, setEcLevel] = useState<EcLevel>("M");
  const [margin, setMargin] = useState(2);
  const [fg, setFg] = useState("#000000");
  const [bg, setBg] = useState("#ffffff");
  const [pngSize, setPngSize] = useState(512);
  const [logo, setLogo] = useState<QrLogo | null>(null);
  const [logoName, setLogoName] = useState("");
  const [saving, setSaving] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const options: QrOptions = { text: content, ecLevel, margin, fg, bg, logo };

  const preview = useMemo<Preview>(() => {
    if (!content.trim()) return { status: "empty" };
    try {
      const matrix = buildMatrix(options);
      return { status: "ok", matrix, svg: qrSvg(options) };
    } catch (error) {
      return { status: "error", raw: errText(error) };
    }
  }, [content, ecLevel, margin, fg, bg, logo]);

  const pickLogo = () => logoInputRef.current?.click();

  const onLogoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      message.warning(t("qr.onlyImage"));
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      message.warning(t("qr.logoTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setLogo({ dataUrl: reader.result, ratio: 0.2, padding: 1 });
      setLogoName(file.name);
    };
    reader.onerror = () => message.error(t("qr.scanReadFailed", { error: "FileReader" }));
    reader.readAsDataURL(file);
  };

  const savePng = async () => {
    if (preview.status !== "ok") return;
    setSaving(true);
    try {
      const canvas = document.createElement("canvas");
      const logoImage = logo ? await loadImageElement(logo.dataUrl).catch(() => null) : null;
      drawQr(canvas, options, pngSize, logoImage);
      const path = await saveDataUrl(
        "qrcode.png",
        canvas.toDataURL("image/png"),
        [{ name: t("qr.dialogPng"), extensions: ["png"] }],
      );
      if (path) message.success(t("qr.saved", { name: basename(path) }));
    } catch (error) {
      message.error(t("qr.saveFailed", { error: errText(error) }));
    } finally {
      setSaving(false);
    }
  };

  const saveSvg = async () => {
    if (preview.status !== "ok") return;
    setSaving(true);
    try {
      const svg = qrSvg(options, Math.max(1024, pngSize));
      const path = await saveText(
        "qrcode.svg",
        svg,
        [{ name: t("qr.dialogSvg"), extensions: ["svg"] }],
      );
      if (path) message.success(t("qr.saved", { name: basename(path) }));
    } catch (error) {
      message.error(t("qr.saveFailed", { error: errText(error) }));
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    onContentChange("");
    setEcLevel("M");
    setMargin(2);
    setFg("#000000");
    setBg("#ffffff");
    setLogo(null);
    setLogoName("");
  };

  const effectiveEc = logo ? "H" : ecLevel;

  return (
    <div className="qr-body">
      <section className="qr-panel">
        <div className="qr-panel-head">
          <span className="qr-panel-title">
            <QrcodeOutlined /> {t("qr.content")}
          </span>
          <span style={{ flex: 1 }} />
          <Tooltip title={t("qr.reset")}>
            <Button size="small" type="text" icon={<ClearOutlined />} onClick={reset} />
          </Tooltip>
        </div>

        <div className="qr-panel-scroll">
          <div className="qr-field">
            <Input.TextArea
              value={content}
              onChange={(event) => onContentChange(event.target.value)}
              placeholder={t("qr.contentPlaceholder")}
              autoSize={{ minRows: 4, maxRows: 8 }}
              className="qr-content"
              allowClear
            />
            <div className="qr-hint qr-count">{content.length}</div>
          </div>

          <div className="qr-grid">
            <div className="qr-field">
              <span className="qr-label">{t("qr.ecLevel")}</span>
              <Select
                value={ecLevel}
                onChange={(value) => setEcLevel(value as EcLevel)}
                options={EC_LEVELS}
                disabled={!!logo}
              />
              <span className="qr-hint">
                {logo ? t("qr.logoHint") : t("qr.ecHint")}
              </span>
            </div>
            <div className="qr-field">
              <span className="qr-label">{t("qr.margin")}</span>
              <Select
                value={margin}
                onChange={(value) => setMargin(Number(value))}
                options={MARGIN_OPTIONS}
              />
              <span className="qr-hint">{t("qr.marginHint")}</span>
            </div>
          </div>

          <div className="qr-grid">
            <div className="qr-field">
              <span className="qr-label">{t("qr.foreground")}</span>
              <div className="qr-color-row">
                <input
                  type="color"
                  className="qr-color"
                  value={fg}
                  onChange={(event) => setFg(event.target.value)}
                  aria-label={t("qr.foreground")}
                />
                <span className="qr-color-code">{fg.toUpperCase()}</span>
              </div>
            </div>
            <div className="qr-field">
              <span className="qr-label">{t("qr.background")}</span>
              <div className="qr-color-row">
                <input
                  type="color"
                  className="qr-color"
                  value={bg}
                  onChange={(event) => setBg(event.target.value)}
                  aria-label={t("qr.background")}
                />
                <span className="qr-color-code">{bg.toUpperCase()}</span>
              </div>
            </div>
          </div>

          <div className="qr-field">
            <span className="qr-label">{t("qr.logo")}</span>
            <div className="qr-logo-row">
              <Button icon={<PictureOutlined />} onClick={pickLogo} size="small">
                {logo ? t("qr.logoReplace") : t("qr.logoPick")}
              </Button>
              {logo && (
                <Button
                  size="small"
                  type="text"
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    setLogo(null);
                    setLogoName("");
                  }}
                >
                  {t("qr.logoRemove")}
                </Button>
              )}
              {logo && (
                <span className="qr-logo-name" title={logoName}>
                  {logoName}
                </span>
              )}
            </div>
            {logo && (
              <div className="qr-field qr-logo-size">
                <div className="qr-label">
                  <span>{t("qr.logoSize")}</span>
                  <span className="qr-hint">{Math.round(logo.ratio * 100)}%</span>
                </div>
                <Slider
                  min={12}
                  max={30}
                  value={Math.round(logo.ratio * 100)}
                  onChange={(value) => setLogo({ ...logo, ratio: value / 100 })}
                />
              </div>
            )}
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              hidden
              onChange={onLogoChange}
            />
          </div>
        </div>
      </section>

      <section className="qr-preview">
        <div className="qr-preview-head">
          <span className="qr-preview-title">{t("qr.preview")}</span>
          {preview.status === "ok" && (
            <span className="qr-hint qr-meta">
              {t("qr.meta", { version: preview.matrix.version, size: preview.matrix.size })}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <Tooltip title={t("qr.pngSize")}>
            <Select
              size="small"
              value={pngSize}
              onChange={(value) => setPngSize(Number(value))}
              options={PNG_SIZES.map((value) => ({ value, label: `${value}px` }))}
              className="qr-size-select"
            />
          </Tooltip>
          <Tooltip title={t("qr.savePng")}>
            <Button
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => void savePng()}
              disabled={preview.status !== "ok" || saving}
            >
              PNG
            </Button>
          </Tooltip>
          <Tooltip title={t("qr.saveSvg")}>
            <Button
              size="small"
              icon={<CodeOutlined />}
              onClick={() => void saveSvg()}
              disabled={preview.status !== "ok" || saving}
            >
              SVG
            </Button>
          </Tooltip>
        </div>

        <div className="qr-preview-body">
          {preview.status === "empty" && (
            <div className="qr-empty-state">
              <span className="qr-empty-icon">
                <FileImageOutlined />
              </span>
              <div className="qr-empty-title">{t("qr.previewEmpty")}</div>
            </div>
          )}
          {preview.status === "error" && (
            <div className="qr-error">
              {looksTooLong(preview.raw) ? t("qr.previewTooLong") : preview.raw}
            </div>
          )}
          {preview.status === "ok" && (
            <div className="qr-canvas-box">
              <div
                className="qr-svg"
                // SVG 由本模块自己的渲染函数生成，内容只来自用户输入
                dangerouslySetInnerHTML={{ __html: preview.svg }}
              />
              <Typography.Text type="secondary" className="qr-effective">
                {t("qr.ecLevel")}: {effectiveEc}
              </Typography.Text>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
