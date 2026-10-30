import { useState } from "react";
import { Segmented, Typography } from "antd";
import { CodeOutlined, DiffOutlined } from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { TextNavIcon } from "../../components/NavIcons";
import { useT } from "../../i18n";
import JsonTool from "./JsonTool";
import TextDiff from "./TextDiff";

type Tab = "json" | "diff";

export default function TextModule() {
  const t = useT(useUiStore((state) => state.lang));
  const [tab, setTab] = useState<Tab>("json");

  return (
    <div className="module text-module">
      <header className="module-head">
        <span className="module-icon">
          <TextNavIcon />
        </span>
        <div>
          <Typography.Text strong style={{ fontSize: 14 }}>
            {t("module.text")}
          </Typography.Text>
          <div className="module-desc">{t("module.textDesc")}</div>
        </div>
        <span style={{ flex: 1 }} />
        <Segmented
          value={tab}
          onChange={(value) => setTab(value as Tab)}
          options={[
            {
              value: "json",
              label: (
                <span className="txt-tab-label">
                  <CodeOutlined /> {t("text.tabJson")}
                </span>
              ),
            },
            {
              value: "diff",
              label: (
                <span className="txt-tab-label">
                  <DiffOutlined /> {t("text.tabDiff")}
                </span>
              ),
            },
          ]}
        />
      </header>

      <div className="txt-slot" style={{ display: tab === "json" ? "flex" : "none" }}>
        <JsonTool />
      </div>
      <div className="txt-slot" style={{ display: tab === "diff" ? "flex" : "none" }}>
        <TextDiff />
      </div>
    </div>
  );
}
