import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  App as AntdApp,
  Button,
  Input,
  Segmented,
  Select,
  Slider,
  Tooltip,
  Typography,
} from "antd";
import {
  ClearOutlined,
  CodeOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  PictureOutlined,
  PlusOutlined,
  QrcodeOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText, basename } from "../../utils";
import { saveDataUrl, saveText } from "../../save";
import { SideResizer } from "../../components/SideResizer";
import { loadStored, saveStored } from "../../storage";
import {
  buildMatrix,
  captionFont,
  drawQr,
  loadImageElement,
  qrSvg,
  type EcLevel,
  type LogoShape,
  type QrCaption,
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
  const CAPTION_FONTS_OPTIONS = [
    { value: "system", label: t("qr.fontSystem") },
    { value: "sans", label: t("qr.fontSans") },
    { value: "serif", label: t("qr.fontSerif") },
    { value: "mono", label: t("qr.fontMono") },
    { value: "kai", label: t("qr.fontKai") },
  ];
  const { message } = AntdApp.useApp();

  const [ecLevel, setEcLevel] = useState<EcLevel>("M");
  const panelWidth = useUiStore((state) => state.sideWidth);
  const setPanelWidth = useUiStore((state) => state.setSideWidth);
  const [margin, setMargin] = useState(1);
  const [dotRadius, setDotRadius] = useState(0);
  const [bgRadius, setBgRadius] = useState(0);
  const [fg, setFg] = useState("#000000");
  const [bg, setBg] = useState("#ffffff");
  const [pngSize, setPngSize] = useState(512);
  const [logo, setLogo] = useState<QrLogo | null>(null);
  const [logoName, setLogoName] = useState("");
  const [logoShape, setLogoShape] = useState<LogoShape>("original");
  const [logoShadow, setLogoShadow] = useState(false);
  const [logoRatio, setLogoRatio] = useState(0.2);
  const makeCaption = (): QrCaption => ({
    id: crypto.randomUUID(),
    text: "",
    x: 0.5,
    y: 0.93,
    size: 3,
    color: "#000000",
    font: "system",
    vertical: false,
  });
  const [captions, setCaptions] = useState<QrCaption[]>([makeCaption()]);
  const [captionPad, setCaptionPad] = useState({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
  const [activeCaption, setActiveCaption] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState(80);
  const [saving, setSaving] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  /* 打开时从后端恢复上次的二维码设置 */
  useEffect(() => {
    let alive = true;
    void loadStored("qr.settings").then((raw) => {
      if (!alive) return;
      if (raw) {
        try {
          const data = JSON.parse(raw) as Record<string, unknown>;
          if (typeof data.ecLevel === "string") setEcLevel(data.ecLevel as EcLevel);
          if (typeof data.margin === "number") setMargin(data.margin);
          if (typeof data.fg === "string") setFg(data.fg);
          if (typeof data.bg === "string") setBg(data.bg);
          if (typeof data.dotRadius === "number") setDotRadius(data.dotRadius);
          if (typeof data.bgRadius === "number") setBgRadius(data.bgRadius);
          if (typeof data.logoRatio === "number") setLogoRatio(data.logoRatio);
          if (
            data.logoShape === "original" ||
            data.logoShape === "rect" ||
            data.logoShape === "circle" ||
            data.logoShape === "rounded"
          ) {
            setLogoShape(data.logoShape);
          }
          if (typeof data.logoShadow === "boolean") setLogoShadow(data.logoShadow);
          if (typeof data.pngSize === "number") setPngSize(data.pngSize);
          if (typeof data.previewZoom === "number") setPreviewZoom(data.previewZoom);
          if (data.captionPad && typeof data.captionPad === "object") {
            const pad = data.captionPad as Record<string, unknown>;
            setCaptionPad({
              top: typeof pad.top === "number" ? pad.top : 0,
              right: typeof pad.right === "number" ? pad.right : 0,
              bottom: typeof pad.bottom === "number" ? pad.bottom : 0,
              left: typeof pad.left === "number" ? pad.left : 0,
            });
          }
          if (Array.isArray(data.captions)) {
            const restored = (data.captions as Record<string, unknown>[])
              .filter((item) => typeof item === "object" && item !== null)
              .map((item) => ({
                id: crypto.randomUUID(),
                text: typeof item.text === "string" ? item.text : "",
                x: typeof item.x === "number" ? item.x : 0.5,
                y: typeof item.y === "number" ? item.y : 0.93,
                size: typeof item.size === "number" ? item.size : 3,
                color: typeof item.color === "string" ? item.color : "#000000",
                font: typeof item.font === "string" ? item.font : "system",
                vertical: item.vertical === true,
              }));
            if (restored.length > 0) setCaptions(restored);
          }
        } catch {
          /* 数据坏了就用默认值 */
        }
      }
      setSettingsLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  /* 任何参数变化都防抖写回后端（Logo 图片不存，避免体积过大） */
  useEffect(() => {
    if (!settingsLoaded) return;
    const timer = window.setTimeout(() => {
      void saveStored(
        "qr.settings",
        JSON.stringify({
          ecLevel,
          margin,
          fg,
          bg,
          dotRadius,
          bgRadius,
          logoRatio,
          logoShape,
          logoShadow,
          pngSize,
          previewZoom,
          captionPad,
          captions: captions.map(({ text, x, y, size, color, font, vertical }) => ({
            text,
            x,
            y,
            size,
            color,
            font,
            vertical,
          })),
        }),
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    settingsLoaded,
    ecLevel,
    margin,
    fg,
    bg,
    dotRadius,
    bgRadius,
    logoRatio,
    logoShape,
    logoShadow,
    pngSize,
    previewZoom,
    captionPad,
    captions,
  ]);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const canvasBoxRef = useRef<HTMLDivElement | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const draggingRef = useRef(false);

  const observerRef = useRef<ResizeObserver | null>(null);
  const setCanvasBox = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    canvasBoxRef.current = element;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      // 拖动文字时冻结尺寸，避免拖动过程中重新计算字号
      if (draggingRef.current) return;
      setCanvasWidth(element.clientWidth);
    });
    observer.observe(element);
    observerRef.current = observer;
    setCanvasWidth(element.clientWidth);
  }, []);

  const options: QrOptions = {
    text: content,
    ecLevel,
    margin,
    fg,
    bg,
    dotRadius,
    bgRadius,
    logo: logo
      ? { ...logo, ratio: logoRatio, shape: logoShape, shadow: logoShadow }
      : null,
    captions,
    captionPad,
  };

  const preview = useMemo<Preview>(() => {
    if (!content.trim()) return { status: "empty" };
    try {
      const matrix = buildMatrix(options);
      // 预览里文字由可拖动的 HTML 层负责，SVG 不再重复绘制，避免重影
      return { status: "ok", matrix, svg: qrSvg({ ...options, captions: [] }) };
    } catch (error) {
      return { status: "error", raw: errText(error) };
    }
  }, [
    content,
    ecLevel,
    margin,
    fg,
    bg,
    dotRadius,
    bgRadius,
    logo,
    logoRatio,
    logoShape,
    logoShadow,
    captions,
    captionPad,
  ]);

  const patchCaption = (id: string, patch: Partial<QrCaption>) => {
    setCaptions((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  };

  const addCaption = () => {
    setCaptions((prev) => [
      ...prev,
      {
        ...makeCaption(),
        y: 0.5,
      },
    ]);
  };

  /** 初始化文字标注：清空所有文字，留白归零 */
  const resetCaptions = () => {
    setCaptions([makeCaption()]);
    setCaptionPad({ top: 0, right: 0, bottom: 0, left: 0 });
    setActiveCaption(null);
  };

  const removeCaption = (id: string) => {
    setCaptions((prev) => prev.filter((item) => item.id !== id));
  };

  /** 拖动文字：坐标限制在画布内（0.02 ~ 0.98）；点击已选中的框则取消选中 */
  const startCaptionDrag = (
    event: React.MouseEvent<HTMLDivElement>,
    id: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const wasActive = activeCaption === id;
    if (!wasActive) setActiveCaption(id);
    draggingRef.current = true;

    const box = canvasBoxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;

    const move = (moveEvent: MouseEvent) => {
      if (
        Math.abs(moveEvent.clientX - startX) > 3 ||
        Math.abs(moveEvent.clientY - startY) > 3
      ) {
        moved = true;
      }
      const x = Math.min(
        0.98,
        Math.max(0.02, (moveEvent.clientX - rect.left) / rect.width),
      );
      const y = Math.min(
        0.98,
        Math.max(0.02, (moveEvent.clientY - rect.top) / rect.height),
      );
      patchCaption(id, { x, y });
    };
    const up = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      // 已选中且没有拖动 = 单纯再点一次：取消选中并失焦
      if (wasActive && !moved) {
        setActiveCaption(null);
        (document.activeElement as HTMLElement | null)?.blur();
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  /** 复位样式与容错（纠错级别 / 静区 / 前景色 / 背景色） */
  const resetStyle = () => {
    setEcLevel("M");
    setMargin(1);
    setDotRadius(0);
    setBgRadius(0);
    setFg("#000000");
    setBg("#ffffff");
  };

  /** 导出文件名：qrcode_20261031_230211.png */
  const qrFileName = (ext: "png" | "svg") => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `qrcode_${stamp}.${ext}`;
  };

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
      setLogo({
        dataUrl: reader.result,
        ratio: logoRatio,
        padding: 1,
        shape: logoShape,
        shadow: logoShadow,
      });
      setLogoName(file.name);
    };
    reader.onerror = () =>
      message.error(t("qr.scanReadFailed", { error: "FileReader" }));
    reader.readAsDataURL(file);
  };

  const savePng = async () => {
    if (preview.status !== "ok") return;
    setSaving(true);
    try {
      const canvas = document.createElement("canvas");
      const logoImage = logo
        ? await loadImageElement(logo.dataUrl).catch(() => null)
        : null;
      drawQr(canvas, options, pngSize, logoImage);
      const path = await saveDataUrl(
        qrFileName("png"),
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
        qrFileName("svg"),
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

  const resetLogo = () => {
    setLogo(null);
    setLogoName("");
    setLogoShape("original");
    setLogoShadow(false);
    setLogoRatio(0.2);
  };

  /** 只把样式重置为默认值，不动内容与 logo 图片 */
  const resetSettings = () => {
    resetStyle();
    setLogoRatio(0.2);
  };

  /** 全部重置：内容、样式、Logo、文字标注、导出尺寸 */
  const reset = () => {
    onContentChange("");
    resetStyle();
    resetLogo();
    resetCaptions();
    setPngSize(512);
    setPreviewZoom(80);
  };

  const effectiveEc = logo ? "H" : ecLevel;

  return (
    <div className="qr-body">
      <section className="qr-panel" style={{ width: panelWidth }}>
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
          <div className="qr-group">
            <div className="qr-group-title">{t("qr.groupContent")}</div>
            <div className="qr-field">
              <Input.TextArea
                value={content}
                onChange={(event) => onContentChange(event.target.value)}
                placeholder={t("qr.contentPlaceholder")}
                autoSize={{ minRows: 4, maxRows: 8 }}
                className="qr-content"
                maxLength={2000}
                allowClear
              />
              <div className="qr-count">
                {content.length} / 2000
              </div>
            </div>
          </div>

          <div className="qr-group">
            <div className="qr-group-title qr-group-title-row">
              <span>{t("qr.groupStyle")}</span>
              <Tooltip title={t("qr.resetSettings")}>
                <Button
                  size="small"
                  type="text"
                  icon={<UndoOutlined />}
                  onClick={resetSettings}
                />
              </Tooltip>
            </div>
            <div className="qr-stack">
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
                <div className="qr-label">
                  <span>{t("qr.margin")}</span>
                  <span className="qr-hint">{margin}</span>
                </div>
                <Slider
                  min={0}
                  max={8}
                  value={margin}
                  onChange={setMargin}
                />
                <span className="qr-hint">{t("qr.marginHint")}</span>
              </div>
              <div className="qr-field">
                <div className="qr-label">
                  <span>{t("qr.dotRadius")}</span>
                  <span className="qr-hint">
                    {Math.round((dotRadius / 0.5) * 100)}%
                  </span>
                </div>
                <Slider
                  min={0}
                  max={0.5}
                  step={0.05}
                  value={dotRadius}
                  onChange={setDotRadius}
                />
                <span className="qr-hint">{t("qr.dotRadiusHint")}</span>
              </div>
              <div className="qr-field">
                <div className="qr-label">
                  <span>{t("qr.bgRadius")}</span>
                  <span className="qr-hint">
                    {Math.round((bgRadius / 0.5) * 100)}%
                  </span>
                </div>
                <Slider
                  min={0}
                  max={0.5}
                  step={0.05}
                  value={bgRadius}
                  onChange={setBgRadius}
                />
                <span className="qr-hint">{t("qr.bgRadiusHint")}</span>
              </div>
            </div>
            <div className="qr-stack">
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
          </div>

          <div className="qr-group">
            <div className="qr-group-title qr-group-title-row">
              <span>{t("qr.groupLogo")}</span>
              <Tooltip title={t("qr.resetLogo")}>
                <Button
                  size="small"
                  type="text"
                  icon={<UndoOutlined />}
                  onClick={resetLogo}
                />
              </Tooltip>
            </div>
            <div className="qr-field">
              <div className="qr-logo-row">
                <Button icon={<PictureOutlined />} onClick={pickLogo} size="small">
                  {logo ? t("qr.logoReplace") : t("qr.logoPick")}
                </Button>
                {logo && (
                  <span className="qr-logo-name" title={logoName}>
                    {logoName}
                  </span>
                )}
              </div>
              <div className="qr-field">
                <span className="qr-label">{t("qr.logoShape")}</span>
                <Segmented
                  size="small"
                  block
                  value={logoShape}
                  onChange={(value) => setLogoShape(value as LogoShape)}
                  options={[
                    { value: "original", label: t("qr.logoShapeOriginal") },
                    { value: "rect", label: t("qr.logoShapeRect") },
                    { value: "circle", label: t("qr.logoShapeCircle") },
                    { value: "rounded", label: t("qr.logoShapeRounded") },
                  ]}
                />
              </div>
              <div className="qr-field">
                <span className="qr-label">{t("qr.logoShadow")}</span>
                <Segmented
                  size="small"
                  block
                  value={logoShadow ? "on" : "off"}
                  onChange={(value) => setLogoShadow(value === "on")}
                  options={[
                    { value: "off", label: t("qr.logoShadowNone") },
                    { value: "on", label: t("qr.logoShadowOn") },
                  ]}
                />
              </div>
              <div className="qr-field qr-logo-size">
                <div className="qr-label">
                  <span>{t("qr.logoSize")}</span>
                  <span className="qr-hint">{Math.round(logoRatio * 100)}%</span>
                </div>
                <Slider
                  min={12}
                  max={30}
                  value={Math.round(logoRatio * 100)}
                  onChange={(value) => setLogoRatio(value / 100)}
                />
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                hidden
                onChange={onLogoChange}
              />
            </div>
          </div>
          <div className="qr-group">
            <div className="qr-group-title qr-group-title-row">
              <span>{t("qr.groupCaption")}</span>
              <Tooltip title={t("qr.resetCaptions")}>
                <Button
                  size="small"
                  type="text"
                  icon={<UndoOutlined />}
                  onClick={resetCaptions}
                />
              </Tooltip>
            </div>
            <div className="qr-caption-pads">
              {(["top", "right", "bottom", "left"] as const).map((side) => (
                <div className="qr-field" key={side}>
                  <div className="qr-label">
                    <span>{t(`qr.pad.${side}`)}</span>
                    <span className="qr-hint">{captionPad[side]}</span>
                  </div>
                  <Slider
                    min={0}
                    max={40}
                    value={captionPad[side]}
                    onChange={(value) =>
                      setCaptionPad((prev) => ({ ...prev, [side]: value }))
                    }
                  />
                </div>
              ))}
            </div>

            {captions.map((cap) => (
              <div
                key={cap.id}
                className={`qr-caption-item${
                  activeCaption === cap.id ? " is-active" : ""
                }`}
                onMouseDown={() => setActiveCaption(cap.id)}
              >
                <div className="qr-caption-item-head">
                  <Input
                    size="small"
                    value={cap.text}
                    maxLength={40}
                    placeholder={t("qr.captionPlaceholder")}
                    onChange={(event) =>
                      patchCaption(cap.id, { text: event.target.value })
                    }
                  />
                  <Button
                    size="small"
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={() => removeCaption(cap.id)}
                  />
                </div>
                <div className="qr-caption-item-row">
                  <Select
                    size="small"
                    value={cap.font}
                    style={{ flex: 1, minWidth: 0 }}
                    onChange={(value) => patchCaption(cap.id, { font: value })}
                    options={CAPTION_FONTS_OPTIONS.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                  />
                  <Segmented
                    size="small"
                    value={cap.vertical ? "v" : "h"}
                    onChange={(value) =>
                      patchCaption(cap.id, { vertical: value === "v" })
                    }
                    options={[
                      { value: "h", label: t("qr.captionHorizontal") },
                      { value: "v", label: t("qr.captionVertical") },
                    ]}
                  />
                </div>
                <div className="qr-caption-item-row">
                  <span className="qr-hint">{t("qr.captionSize")}</span>
                  <Slider
                    min={2}
                    max={10}
                    step={0.5}
                    value={cap.size}
                    style={{ flex: 1, margin: 0 }}
                    onChange={(value) => patchCaption(cap.id, { size: value })}
                  />
                  <input
                    type="color"
                    className="qr-color qr-color-mini"
                    value={cap.color}
                    onChange={(event) =>
                      patchCaption(cap.id, { color: event.target.value })
                    }
                    aria-label={t("qr.captionColor")}
                  />
                </div>
              </div>
            ))}

            <Button size="small" icon={<PlusOutlined />} onClick={addCaption} block>
              {t("qr.captionAdd")}
            </Button>
            <span className="qr-hint">{t("qr.captionHint")}</span>
          </div>

        </div>
      </section>

      <SideResizer width={panelWidth} onChange={setPanelWidth} />

      <section
        className="qr-preview"
        onMouseDown={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest(".qr-caption-box")) return;
          setActiveCaption(null);
          (document.activeElement as HTMLElement | null)?.blur();
        }}
      >
        <div className="qr-preview-head">
          <span className="qr-preview-title">
            <EyeOutlined />
            {t("qr.preview")}
          </span>
          <Tooltip title={t("qr.previewZoom")}>
            <div className="qr-zoom">
              <Slider
                min={20}
                max={100}
                value={previewZoom}
                onChange={setPreviewZoom}
                tooltip={{ open: false }}
              />
              <span className="qr-hint qr-preview-zoom-value">{previewZoom}%</span>
            </div>
          </Tooltip>
          {preview.status === "ok" && (
            <span className="qr-hint qr-meta">
              {t("qr.meta", { version: preview.matrix.version, size: preview.matrix.size })}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <span className="qr-hint qr-download-label">
            {t("qr.downloadSize")}
          </span>
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
                <QrcodeOutlined />
              </span>
              <div className="app-empty-title">{t("qr.previewEmpty")}</div>
              <div className="app-empty-hint">{t("qr.previewEmptyHint")}</div>
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
                className="qr-svg-wrap"
                ref={setCanvasBox}
                style={{ ["--qr-zoom" as string]: previewZoom / 100 }}
              >
              <div
                className="qr-svg"
                // SVG 由本模块自己的渲染函数生成，内容只来自用户输入
                dangerouslySetInnerHTML={{ __html: preview.svg }}
              />
              {preview.status === "ok" &&
                captions.map((cap) =>
                  cap.text.trim() ? (
                    <div
                      key={cap.id}
                      className={`qr-caption-box${
                        activeCaption === cap.id ? " is-active" : ""
                      }`}
                      style={{
                        left: `${cap.x * 100}%`,
                        top: `${cap.y * 100}%`,
                        color: cap.color,
                        fontFamily: captionFont(cap.font),
                        writingMode: cap.vertical ? "vertical-rl" : undefined,
                        textOrientation: "upright",
                        fontSize:
                          cap.size *
                          (canvasWidth /
                            (preview.matrix.size +
                              Math.max(0, Math.round(margin)) * 2 +
                              Math.max(0, Math.round(captionPad.left)) +
                              Math.max(0, Math.round(captionPad.right)))),
                      }}
                      onMouseDown={(event) => startCaptionDrag(event, cap.id)}
                      title={t("qr.captionDragHint")}
                    >
                      {cap.text}
                    </div>
                  ) : null,
                )}
              </div>
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
