import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { App as AntdApp, Button, Tooltip } from "antd";
import {
  CheckCircleOutlined,
  CopyOutlined,
  InboxOutlined,
  LinkOutlined,
  LoadingOutlined,
  ClearOutlined,
  QrcodeOutlined,
  ScanOutlined,
} from "@ant-design/icons";
import jsQR from "jsqr";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import { copyText } from "../../clipboard";
import { SideResizer } from "../../components/SideResizer";
import { loadImageElement } from "./qrRender";

interface Props {
  onUseContent: (text: string) => void;
}

interface ImageInfo {
  url: string;
  name: string;
  width: number;
  height: number;
}

const MAX_EDGE = 1600;

export default function QrScanPanel({ onUseContent }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const { message } = AntdApp.useApp();

  const [dragActive, setDragActive] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [image, setImage] = useState<ImageInfo | null>(null);
  const [decoded, setDecoded] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const panelWidth = useUiStore((state) => state.sideWidth);
  const setPanelWidth = useUiStore((state) => state.setSideWidth);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.url);
    },
    [image],
  );

  const decodeFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      message.warning(t("qr.onlyImage"));
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setScanError(t("qr.imageTooLarge"));
      return;
    }

    setScanning(true);
    setScanError(null);
    setDecoded(null);

    const url = URL.createObjectURL(file);
    try {
      const source = await loadImageElement(url);
      const naturalWidth = source.naturalWidth || source.width;
      const naturalHeight = source.naturalHeight || source.height;

      /** 在指定区域上识别一次；区域会被缩放到 targetSize 像素宽 */
      const decodeRegion = (
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        targetSize: number,
        threshold?: number,
      ) => {
        if (sw < 24 || sh < 24) return null;
        const ratio = sh / sw;
        const width = Math.max(32, Math.round(targetSize));
        const height = Math.max(32, Math.round(width * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height);
        const data = pixels.data;
        if (threshold !== undefined) {
          // 灰度二值化：应对偏灰、对比度低的图（截图 / 缩放过的二维码）
          for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            const value = gray < threshold ? 0 : 255;
            data[i] = value;
            data[i + 1] = value;
            data[i + 2] = value;
          }
        }
        return jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
      };

      // 先整图，再按九宫格 + 中心区域裁剪：二维码可能只占画面的一小块
      const attempts: [number, number, number, number, number][] = [];
      const fullEdge = Math.max(naturalWidth, naturalHeight);
      const fullTarget = Math.min(MAX_EDGE, Math.max(512, fullEdge));
      attempts.push([0, 0, naturalWidth, naturalHeight, fullTarget]);
      if (fullTarget < 1200) {
        attempts.push([
          0,
          0,
          naturalWidth,
          naturalHeight,
          Math.min(MAX_EDGE, fullTarget * 2),
        ]);
      }
      for (let gy = 0; gy < 3; gy += 1) {
        for (let gx = 0; gx < 3; gx += 1) {
          attempts.push([
            (naturalWidth * gx) / 3,
            (naturalHeight * gy) / 3,
            (naturalWidth / 3) * 1.6,
            (naturalHeight / 3) * 1.6,
            900,
          ]);
        }
      }
      attempts.push([
        naturalWidth * 0.15,
        naturalHeight * 0.15,
        naturalWidth * 0.7,
        naturalHeight * 0.7,
        900,
      ]);

      let result = null;
      // 第一轮：原图；第二轮：二值化（阈值从高到低，覆盖深浅不同的码）
      for (const threshold of [undefined, 190, 160, 128, 100]) {
        for (const [sx, sy, sw, sh, size] of attempts) {
          result = decodeRegion(
            Math.max(0, sx),
            Math.max(0, sy),
            Math.min(sw, naturalWidth - Math.max(0, sx)),
            Math.min(sh, naturalHeight - Math.max(0, sy)),
            size,
            threshold,
          );
          if (result) break;
        }
        if (result) break;
      }

      setImage({ url, name: file.name, width: naturalWidth, height: naturalHeight });
      if (!result) {
        setScanError(t("qr.scanNotFound"));
      } else {
        setDecoded(result.data);
      }
    } catch (error) {
      URL.revokeObjectURL(url);
      setScanError(t("qr.scanReadFailed", { error: errText(error) }));
    } finally {
      setScanning(false);
    }
  };

  /** 清空当前图片与识别结果 */
  const reset = () => {
    if (image) URL.revokeObjectURL(image.url);
    setImage(null);
    setDecoded(null);
    setScanError(null);
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void decodeFile(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void decodeFile(file);
  };

  const copyResult = () => {
    if (!decoded) return;
    void copyText(decoded).then(
      () => message.success(t("qr.copied")),
      () => message.error(t("common.copyFailed")),
    );
  };

  /** 判断识别内容像不像一个可以打开的链接（支持 baidu.com 这种没有协议的写法） */
  const decodedUrl = (() => {
    if (!decoded) return null;
    const value = decoded.trim();
    if (!value || /\s/.test(value)) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
    // 域名（可带端口 / 路径）
    if (/^[\w-]+(\.[\w-]+)+(\/[\w\-./?%&=#]*)?$/.test(value)) {
      return `https://${value}`;
    }
    return null;
  })();

  return (
    <div className="qr-body">
      <section className="qr-panel qr-scan-col" style={{ width: panelWidth }}>
        <div className="qr-panel-head">
          <span className="qr-panel-title">
            <ScanOutlined /> {t("qr.scan")}
          </span>
          <span style={{ flex: 1 }} />
          <Tooltip title={t("qr.scanReset")}>
            <Button size="small" type="text" icon={<ClearOutlined />} onClick={reset} />
          </Tooltip>
        </div>
        <div className="qr-panel-scroll">
          <div
            className={`qr-drop${dragActive ? " active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
          >
            <span className="qr-drop-icon">
              {scanning ? <LoadingOutlined spin /> : <InboxOutlined />}
            </span>
            <div className="qr-drop-title">
              {dragActive ? t("qr.scanDrop") : scanning ? t("qr.scanning") : t("qr.scanHint")}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={onPick}
            />
          </div>

          {scanError && <div className="qr-scan-error">{scanError}</div>}

          {image && (
            <figure className="qr-scan-figure">
              <img className="qr-thumb" src={image.url} alt={image.name} />
              <figcaption className="qr-hint qr-scan-caption">
                {t("qr.scanFile", {
                  name: image.name,
                  width: image.width,
                  height: image.height,
                })}
              </figcaption>
            </figure>
          )}
        </div>
      </section>

      <SideResizer width={panelWidth} onChange={setPanelWidth} />

      <section className="qr-preview qr-result">
        <div className="qr-preview-head">
          <span className="qr-preview-title">
            {decoded ? <CheckCircleOutlined className="qr-ok-icon" /> : <ScanOutlined />}{" "}
            {t("qr.scanResult")}
          </span>
          <span style={{ flex: 1 }} />
          <Button
            size="small"
            icon={<LinkOutlined />}
            disabled={!decodedUrl}
            onClick={() => {
              if (!decodedUrl) return;
              // 交给内部浏览器打开，不再调系统浏览器
              window.dispatchEvent(
                new CustomEvent("yooso:open-browser", { detail: decodedUrl }),
              );
            }}
          >
            {t("qr.openLink")}
          </Button>
          <Button
            size="small"
            icon={<CopyOutlined />}
            disabled={!decoded}
            onClick={copyResult}
          >
            {t("common.copy")}
          </Button>
          <Button
            size="small"
            icon={<QrcodeOutlined />}
            disabled={!decoded}
            onClick={() => {
              if (decoded) onUseContent(decoded);
            }}
          >
            {t("qr.useAsContent")}
          </Button>
        </div>

        <div className="qr-preview-body qr-result-body">
          {decoded ? (
            <pre className="qr-result-pre">{decoded}</pre>
          ) : (
            <div className="qr-empty-state">
              <span className="qr-empty-icon">
                <ScanOutlined />
              </span>
              <div className="app-empty-title">{t("qr.scanEmpty")}</div>
              <div className="app-empty-hint">{t("qr.scanEmptyHint")}</div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
