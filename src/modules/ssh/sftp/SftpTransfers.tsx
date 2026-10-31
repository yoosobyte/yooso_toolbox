import { Button, Progress, Typography } from "antd";

import { useT } from "../../../i18n";
import { useUiStore } from "../../../stores/uiStore";
import type { TransferItem } from "../../../types";

interface Props {
  transfers: TransferItem[];
  onClear: () => void;
}

/** 底部传输进度列表：方向、文件名、百分比 / 完成 / 失败状态。 */
export default function SftpTransfers({ transfers, onClear }: Props) {
  const lang = useUiStore((state) => state.lang);
  const t = useT(lang);

  return (
    <div className="transfers">
      <div style={{ display: "flex", alignItems: "center", marginBottom: 2 }}>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {t("sftp.transfers")}
        </Typography.Text>
        <span style={{ flex: 1 }} />
        <Button
          type="text"
          size="small"
          style={{ fontSize: 11 }}
          onClick={onClear}
        >
          {t("sftp.clear")}
        </Button>
      </div>
      {transfers.map((item) => (
        <div className="transfer-item" key={item.id}>
          <div className="transfer-line">
            <span>{item.direction === "upload" ? "↑" : "↓"}</span>
            <span className="transfer-name" title={item.name}>
              {item.name}
            </span>
            <span style={{ color: item.status === "error" ? "#f87171" : "#8b9bb4" }}>
              {item.status === "done"
                ? t("sftp.done")
                : item.status === "error"
                  ? t("sftp.failed")
                  : `${item.percent.toFixed(0)}%`}
            </span>
          </div>
          <Progress
            percent={Math.round(item.percent)}
            size={{ height: 3 }}
            showInfo={false}
            status={
              item.status === "error" ? "exception" : item.status === "done" ? "success" : "active"
            }
            strokeColor={item.status === "error" ? "#ef4444" : "#3b82f6"}
          />
        </div>
      ))}
    </div>
  );
}
