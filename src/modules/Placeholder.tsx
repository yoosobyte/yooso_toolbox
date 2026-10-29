import { Typography, Tag } from "antd";
import type { ReactNode } from "react";
import { useUiStore } from "../stores/uiStore";
import { useT } from "../i18n";

interface Props {
  title: string;
  desc: string;
  icon: ReactNode;
  features: string[];
}

export default function Placeholder({ title, desc, icon, features }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  return (
    <div className="module">
      <header className="module-head">
        <span className="module-icon">{icon}</span>
        <div>
          <Typography.Text strong style={{ fontSize: 14 }}>
            {title}
          </Typography.Text>
          <div className="module-desc">{desc}</div>
        </div>
        <Tag color="blue" bordered={false} style={{ marginLeft: 8 }}>
          {t("placeholder.planned")}
        </Tag>
      </header>

      <div className="placeholder-body">
        <div className="placeholder-card">
          <div className="placeholder-glyph">{icon}</div>
          <Typography.Title level={4} style={{ margin: "6px 0 4px" }}>
            {title}
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 22 }}>
            {t("placeholder.note", { desc })}
          </Typography.Paragraph>
          <div className="feature-grid">
            {features.map((feature) => (
              <div className="feature-item" key={feature}>
                <span className="feature-bullet" />
                {feature}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
