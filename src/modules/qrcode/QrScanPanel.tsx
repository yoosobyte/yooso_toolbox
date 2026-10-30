import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { App as AntdApp, Button, Tooltip } from "antd";
import {
  CheckCircleOutlined,
  CopyOutlined,
  FileImageOutlined,
  InboxOutlined,
  LinkOutlined,
  LoadingOutlined,
  ScanOutlined,
} from "@ant-design/icons";
import jsQR from "jsqr";
import { openUrl } from "@tauri-apps/plugin-opener";
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
      const scale = Math.min(1, MAX_EDGE / Math.max(naturalWidth, naturalHeight));
      const width = Math.max(1, Math.round(naturalWidth * scale));
      const height = Math.max(1, Math.round(naturalHeight * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas 2D unavailable");
      ctx.drawImage(source, 0, 0, width, height);
      const pixels = ctx.getImageData(0, 0, width, height);

      const result = jsQR(pixels.data, width, height, { inversionAttempts: "attemptBoth" });
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

  const decodedUrl =
    decoded && /^https?:\/\/\S+$/i.test(decoded.trim()) ? decoded.trim() : null;

  return (
    <div className="qr-body">
      <section className="qr-panel qr-scan-col" style={{ width: panelWidth }}>
        <div className="qr-panel-head">
          <span className="qr-panel-title">
            <ScanOutlined /> {t("qr.scan")}
          </span>
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
            <Button size="small" icon={<FileImageOutlined />} loading={scanning}>
              {t("qr.scanPick")}
            </Button>
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
          {decoded && (
            <>
              <Tooltip title={t("qr.openLink")}>
                <Button
                  size="small"
                  icon={<LinkOutlined />}
                  disabled={!decodedUrl}
                  onClick={() => {
                    if (!decodedUrl) return;
                    void openUrl(decodedUrl).catch((error) =>
                      message.error(errText(error)),
                    );
                  }}
                />
              </Tooltip>
              <Button size="small" icon={<CopyOutlined />} onClick={copyResult}>
                {t("common.copy")}
              </Button>
              <Button
                size="small"
                type="primary"
                onClick={() => onUseContent(decoded)}
              >
                {t("qr.useAsContent")}
              </Button>
            </>
          )}
        </div>

        <div className="qr-preview-body qr-result-body">
          {decoded ? (
            <pre className="qr-result-pre">{decoded}</pre>
          ) : (
            <div className="qr-empty-state">
              <span className="qr-empty-icon">
                <ScanOutlined />
              </span>
              <div className="qr-empty-title">{t("qr.scanEmpty")}</div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
