import { Button, Popover, Select, Tooltip } from "antd";
import {
  ClearOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useT } from "../../i18n";
import { useUiStore } from "../../stores/uiStore";
import type { MetricsSample, TermTab } from "../../types";
import TerminalMetrics from "./TerminalMetrics";
import TerminalStatus from "./TerminalStatus";
import { TERMINAL_FONTS, TERMINAL_SIZES, useTerminalPrefs } from "./terminalPrefs";

interface Props {
  tab: TermTab;
  metrics: MetricsSample | null;
  net: { rx: number; tx: number };
  onOpenProcesses: () => void;
  onToggleSftp: () => void;
  onClear: () => void;
  onReconnect: () => void;
}

/** 资源管理器图标：方框 + 中间折线 */
function ActivityBoxIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="1.6" y="2.4" width="12.8" height="11.2" rx="1.6" />
      <path d="M3.6 10.4l2.4-2.8 2 1.9 2.4-3.4 2 2.2" />
    </svg>
  );
}

/** 终端底部工具栏：连接状态 + 远端资源监控 + 进程 / SFTP / 清屏 / 重连 */
export default function TerminalToolbar({
  tab,
  metrics,
  net,
  onOpenProcesses,
  onToggleSftp,
  onClear,
  onReconnect,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const font = useTerminalPrefs((state) => state.font);
  const size = useTerminalPrefs((state) => state.size);
  const setFont = useTerminalPrefs((state) => state.setFont);
  const setSize = useTerminalPrefs((state) => state.setSize);

  return (
    <div className="term-toolbar">
      <TerminalStatus status={tab.status} error={tab.error} />
      <span style={{ flex: 1 }} />
      <Tooltip title={t("term.processMgr")}>
        <Button
          size="small"
          type="text"
          icon={<ActivityBoxIcon />}
          disabled={tab.status !== "connected"}
          onClick={onOpenProcesses}
        />
      </Tooltip>
      {tab.status === "connected" && metrics && (
        <TerminalMetrics metrics={metrics} net={net} />
      )}
      <Tooltip title={tab.sftpOpen ? t("term.closeSftp") : t("term.openSftp")}>
        <Button
          size="small"
          type="text"
          icon={tab.sftpOpen ? <FolderOpenOutlined /> : <FolderOutlined />}
          onClick={onToggleSftp}
          disabled={tab.status !== "connected"}
        >
          SFTP
        </Button>
      </Tooltip>
      <Tooltip title={t("term.clear")}>
        <Button size="small" type="text" icon={<ClearOutlined />} onClick={onClear} />
      </Tooltip>
      <Tooltip title={t("term.reconnect")} placement="topRight">
        <Button size="small" type="text" icon={<ThunderboltOutlined />} onClick={onReconnect} />
      </Tooltip>
      <Popover
        trigger="click"
        placement="topRight"
        content={
          <div className="term-prefs">
            <div className="term-prefs-row">
              <span className="term-prefs-label">{t("term.font")}</span>
              <Select
                size="small"
                value={font}
                style={{ width: 150 }}
                onChange={setFont}
                options={Object.keys(TERMINAL_FONTS).map((name) => ({
                  value: name,
                  label: name,
                }))}
              />
            </div>
            <div className="term-prefs-row">
              <span className="term-prefs-label">{t("term.fontSize")}</span>
              <Select
                size="small"
                value={size}
                style={{ width: 150 }}
                onChange={setSize}
                options={TERMINAL_SIZES.map((value) => ({
                  value,
                  label: `${value}px`,
                }))}
              />
            </div>
          </div>
        }
      >
        <Tooltip title={t("term.display")} placement="topRight">
          <Button size="small" type="text" icon={<SettingOutlined />} />
        </Tooltip>
      </Popover>
    </div>
  );
}
