import { Typography } from "antd";
import { useT } from "../../i18n";
import { useUiStore } from "../../stores/uiStore";
import type { TabStatus } from "../../types";
import { STATUS_COLOR, STATUS_KEY } from "./status";

interface Props {
  status: TabStatus;
  error?: string;
}

/** 终端工具栏左侧的连接状态指示：状态圆点 + 文案（错误时附错误原因） */
export default function TerminalStatus({ status, error }: Props) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <>
      <span
        className={`tab-dot ${status === "connecting" ? "connecting" : ""}`}
        style={{ background: STATUS_COLOR[status] }}
      />
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {t(STATUS_KEY[status])}
        {status === "error" && error ? `：${error}` : ""}
      </Typography.Text>
    </>
  );
}
