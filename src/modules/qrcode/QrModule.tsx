import { useState } from "react";
import { Segmented, Typography } from "antd";
import {
  QrcodeOutlined,
  ScanOutlined,
  EditOutlined,
} from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import QrGeneratePanel from "./QrGeneratePanel";
import QrScanPanel from "./QrScanPanel";

type Mode = "generate" | "scan";

export default function QrModule() {
  const t = useT(useUiStore((state) => state.lang));
  const [mode, setMode] = useState<Mode>("generate");
  const [content, setContent] = useState("");

  return (
    <div className="module qr-module">
      <header className="module-head">
        <span className="module-icon">
          <QrcodeOutlined />
        </span>
        <div>
          <Typography.Text strong style={{ fontSize: 14 }}>
            {t("module.qr")}
          </Typography.Text>
          <div className="module-desc">{t("module.qrDesc")}</div>
        </div>
        <span style={{ flex: 1 }} />
        <Segmented
          value={mode}
          onChange={(value) => setMode(value as Mode)}
          options={[
            {
              value: "generate",
              label: (
                <span className="qr-tab-label">
                  <EditOutlined /> {t("qr.generate")}
                </span>
              ),
            },
            {
              value: "scan",
              label: (
                <span className="qr-tab-label">
                  <ScanOutlined /> {t("qr.scan")}
                </span>
              ),
            },
          ]}
        />
      </header>

      <div
        className="qr-slot"
        style={{ display: mode === "generate" ? "flex" : "none" }}
      >
        <QrGeneratePanel content={content} onContentChange={setContent} />
      </div>
      <div className="qr-slot" style={{ display: mode === "scan" ? "flex" : "none" }}>
        <QrScanPanel
          onUseContent={(text) => {
            setContent(text);
            setMode("generate");
          }}
        />
      </div>
    </div>
  );
}
