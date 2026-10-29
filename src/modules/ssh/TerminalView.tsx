import { useEffect, useRef, useState } from "react";
import { App as AntdApp, Button, Tooltip, Typography } from "antd";
import {
  ClearOutlined,
  CopyOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  SelectOutlined,
  SnippetsOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import { sshConnect, sshDisconnect, sshResize, sshWrite, sshMetrics } from "../../api";
import { base64ToBytes, textToBase64 } from "../../base64";
import { copyText, pasteText } from "../../clipboard";
import { terminalThemeFor } from "../../theme";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import type { MetricsSample, SessionConfig, TermTab } from "../../types";
import { errText } from "../../utils";
import { emitTerminalOutput } from "../../events";
import { STATUS_COLOR, STATUS_KEY } from "./status";
import ContextMenu from "../../components/ContextMenu";
import type { ContextMenuItem } from "../../components/ContextMenu";
import ProcessModal from "./ProcessModal";

interface Props {
  tab: TermTab;
  active: boolean;
  config?: SessionConfig;
  onSession: (tabId: string, sessionId: string | null) => void;
  onReconnect: () => void;
  onToggleSftp: () => void;
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

export default function TerminalView({
  tab,
  active,
  config,
  onSession,
  onReconnect,
  onToggleSftp,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [processOpen, setProcessOpen] = useState(false);
  const activeTheme = useUiStore((state) => state.activeTheme);
  const t = useT(useUiStore((state) => state.lang));
  const [sid, setSid] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricsSample | null>(null);
  const [net, setNet] = useState({ rx: 0, tx: 0 });
  const netRef = useRef<{ rx: number; tx: number; at: number } | null>(null);

  const { message } = AntdApp.useApp();
  const setStatus = useWorkspaceStore((state) => state.setStatus);

  /* ---------------- 建立终端 + 连接（attempt 变化时重建） ---------------- */
  useEffect(() => {
    const container = containerRef.current;
    const sessionConfig = configRef.current;
    if (!container || !sessionConfig) return;

    let disposed = false;
    let flushTimer: number | null = null;
    let pending = "";

    const term = new Terminal({
      fontFamily: "'Cascadia Mono', 'JetBrains Mono', Consolas, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 8000,
      theme: terminalThemeFor(useUiStore.getState().activeTheme),
      convertEol: false,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void openUrl(uri).catch(() => undefined);
      }),
    );
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;

    // 复制 / 粘贴：Windows/Linux 用 Ctrl+Shift+C/V（以及 Ctrl+Insert / Shift+Insert），
    // macOS 用 ⌘C / ⌘V（与 iTerm、系统终端一致）
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const copySelection = () => {
      const selection = term.getSelection();
      if (selection) void copyText(selection).catch(() => undefined);
    };
    const pasteInto = () => {
      // 必须阻止默认行为，否则浏览器还会再粘一次（出现「cd /homecd /home」）
      void pasteText()
        .then((text) => {
          if (text) term.paste(text);
        })
        .catch(() => undefined);
    };

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;

      // macOS：⌘C 复制、⌘V 粘贴
      if (isMac && event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.code === "KeyC") {
          event.preventDefault();
          event.stopPropagation();
          copySelection();
          return false;
        }
        if (event.code === "KeyV") {
          event.preventDefault();
          event.stopPropagation();
          pasteInto();
          return false;
        }
        if (event.code === "KeyK") {
          event.preventDefault();
          event.stopPropagation();
          term.clear();
          return false;
        }
      }

      if (event.ctrlKey && event.shiftKey && event.code === "KeyC") {
        event.preventDefault();
        event.stopPropagation();
        copySelection();
        return false;
      }
      if (event.ctrlKey && event.shiftKey && event.code === "KeyV") {
        event.preventDefault();
        event.stopPropagation();
        pasteInto();
        return false;
      }
      // Windows 终端的经典快捷键：Ctrl+Insert 复制、Shift+Insert 粘贴
      if (event.ctrlKey && !event.shiftKey && event.code === "Insert") {
        event.preventDefault();
        event.stopPropagation();
        copySelection();
        return false;
      }
      if (event.shiftKey && !event.ctrlKey && event.code === "Insert") {
        event.preventDefault();
        event.stopPropagation();
        pasteInto();
        return false;
      }
      return true;
    });

    const measure = () => {
      const dims = fit.proposeDimensions();
      if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return null;
      if (dims.cols < 2 || dims.rows < 1) return null;
      fit.fit();
      return dims;
    };

    const initial = measure() ?? { cols: 100, rows: 30 };

    const flushInput = () => {
      flushTimer = null;
      const sessionId = sessionRef.current;
      if (!pending || !sessionId) return;
      const payload = pending;
      pending = "";
      void sshWrite(sessionId, textToBase64(payload)).catch((error) => {
        if (!disposed) message.error(t("term.sendFailed", { error: errText(error) }));
      });
    };

    const dataSub = term.onData((data) => {
      if (!sessionRef.current) return;
      pending += data;
      if (flushTimer == null) flushTimer = window.setTimeout(flushInput, 8);
    });

    setStatus(tab.id, "connecting");
    term.writeln(
      `\x1b[38;5;75m● ${t("term.connecting")} ${sessionConfig.username}@${sessionConfig.host}:${sessionConfig.port} …\x1b[0m`,
    );

    void sshConnect(sessionConfig, initial.cols, initial.rows, (event) => {
      if (disposed) return;
      if (event.type === "data") {
        term.write(base64ToBytes(event.data));
        // 通知 SFTP 面板：终端有输出，可能刚刚 cd 过
        if (sessionRef.current) emitTerminalOutput(sessionRef.current);
        return;
      }
      if (event.type === "connected") {
        setStatus(tab.id, "connected");
        term.writeln(
          `\r\n\x1b[38;5;114m✔ ${t("term.connected")}${event.message ? ` · ${event.message}` : ""}\x1b[0m`,
        );
        return;
      }
      setStatus(tab.id, "closed");
      term.writeln(
        `\r\n\x1b[38;5;180m● ${t("term.disconnected")}${event.reason ? ` (${event.reason})` : ""}\x1b[0m`,
      );
    })
      .then((result) => {
        if (disposed) {
          void sshDisconnect(result.sessionId).catch(() => undefined);
          return;
        }
        sessionRef.current = result.sessionId;
        setSid(result.sessionId);
        onSession(tab.id, result.sessionId);
        // 连接建立期间如果尺寸已变化，补发一次
        const dims = fit.proposeDimensions();
        if (dims) {
          void sshResize(result.sessionId, dims.cols, dims.rows).catch(() => undefined);
        }
        term.focus();
      })
      .catch((error) => {
        if (disposed) return;
        setStatus(tab.id, "error", errText(error));
        term.writeln(`\r\n\x1b[38;5;203m✘ ${t("term.connectFailed")}${errText(error)}\x1b[0m`);
      });

    const observer = new ResizeObserver(() => {
      if (disposed) return;
      if (container.clientWidth < 20 || container.clientHeight < 20) return;
      const dims = fit.proposeDimensions();
      if (!dims) return;
      fit.fit();
      const sessionId = sessionRef.current;
      if (sessionId) {
        void sshResize(sessionId, dims.cols, dims.rows).catch(() => undefined);
      }
    });
    observer.observe(container);

    return () => {
      disposed = true;
      if (flushTimer != null) window.clearTimeout(flushTimer);
      dataSub.dispose();
      observer.disconnect();
      const sessionId = sessionRef.current;
      sessionRef.current = null;
      setSid(null);
      if (sessionId) {
        void sshDisconnect(sessionId).catch(() => undefined);
        onSession(tab.id, null);
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // 仅在重连（attempt 变化）时重建；配置在 configRef 中读取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.attempt, tab.id]);

  /* ---------------- 窗口级复制快捷键（WebView2 有时会吞掉 Ctrl+Shift+C） ---------------- */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Windows/Linux: Ctrl+Shift+C；macOS: ⌘C（仅在终端有选中文本时接管）
      const combo = event.ctrlKey && event.shiftKey && event.code === "KeyC";
      const macCombo = event.metaKey && !event.ctrlKey && event.code === "KeyC";
      if (!combo && !macCombo) return;
      const selection = termRef.current?.getSelection();
      // 没有选中终端文本时不要干预，避免影响输入框里的正常复制
      if (!selection) return;
      event.preventDefault();
      event.stopPropagation();
      void copyText(selection).then(
        () => message.success(t("term.copied")),
        () => message.error(t("common.copyFailed")),
      );
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- 切到该标签时重新适配尺寸 ---------------- */  useEffect(() => {
    if (!active) return;
    const handle = window.requestAnimationFrame(() => {
      const fit = fitRef.current;
      const term = termRef.current;
      if (!fit || !term) return;
      const dims = fit.proposeDimensions();
      if (!dims) return;
      fit.fit();
      const sessionId = sessionRef.current;
      if (sessionId) {
        void sshResize(sessionId, dims.cols, dims.rows).catch(() => undefined);
      }
      term.focus();
    });
    return () => window.cancelAnimationFrame(handle);
  }, [active]);

  /* ---------------- 远端系统监控（每 3 秒一次） ---------------- */

  useEffect(() => {
    if (!sid || !active) return;
    let cancelled = false;

    const tick = async () => {
      if (!sid) return;
      try {
        const sample = await sshMetrics(sid);
        if (cancelled) return;
        setMetrics(sample);

        const now = performance.now();
        const prev = netRef.current;
        if (prev && now > prev.at) {
          const seconds = (now - prev.at) / 1000;
          setNet({
            rx: Math.max(0, (sample.netRx - prev.rx) / seconds),
            tx: Math.max(0, (sample.netTx - prev.tx) / seconds),
          });
        }
        netRef.current = { rx: sample.netRx, tx: sample.netTx, at: now };
      } catch {
        /* 单次采集失败忽略 */
      }
    };

    // 刚连上就先取一次，让状态栏尽快有数据
    void tick();
    const boot = window.setTimeout(() => void tick(), 300);
    const timer = window.setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(boot);
      window.clearInterval(timer);
      netRef.current = null;
    };
  }, [sid, active]);

  /* 主题切换时同步终端配色 */
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = terminalThemeFor(activeTheme);
    }
  }, [activeTheme]);

  const percent = (used: number, total: number) =>
    total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const levelClass = (value: number) => (value >= 85 ? "high" : value >= 65 ? "mid" : "");
  /** 进度条填充宽度：0 就完全不画，非 0 至少留 1.5% 以免看不见 */
  const fillWidth = (value: number) =>
    `${value <= 0 ? 0 : Math.max(1.5, Math.min(100, value))}%`;
  const formatRate = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes < 1) return "0 B/s";
    const units = ["B/s", "KB/s", "MB/s", "GB/s"];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)}${units[index]}`;
  };
  const formatSize = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)}${units[index]}`;
  };

  /** 菜单/按钮操作后把焦点还给终端，这样粘贴完直接按回车就能执行 */
  const focusTerminal = () => {
    window.setTimeout(() => termRef.current?.focus(), 0);
  };

  const copySelection = () => {
    const selection = termRef.current?.getSelection();
    if (!selection) {
      message.info(t("term.selectFirst"));
      return;
    }
    void copyText(selection).then(
      () => message.success(t("term.copied")),
      () => message.error(t("common.copyFailed")),
    );
    focusTerminal();
  };

  const pasteClipboard = async () => {
    try {
      const text = await pasteText();
      if (text) termRef.current?.paste(text);
    } catch {
      message.error(t("term.clipboardFailed"));
    } finally {
      focusTerminal();
    }
  };

  const menuItems: ContextMenuItem[] = [
    {
      key: "copy",
      icon: <CopyOutlined />,
      label: t("common.copy"),
      disabled: !termRef.current?.hasSelection(),
      onClick: copySelection,
    },
    { key: "paste", icon: <SnippetsOutlined />, label: t("common.paste"), onClick: () => void pasteClipboard() },
    {
      key: "select-all",
      icon: <SelectOutlined />,
      label: t("term.selectAll"),
      onClick: () => {
        termRef.current?.selectAll();
        focusTerminal();
      },
    },
    { type: "divider" },
    {
      key: "clear",
      icon: <ClearOutlined />,
      label: t("term.clear"),
      onClick: () => {
        termRef.current?.clear();
        focusTerminal();
      },
    },
    {
      key: "reconnect",
      icon: <ThunderboltOutlined />,
      label: t("term.reconnect"),
      onClick: onReconnect,
    },
    {
      key: "sftp",
      icon: tab.sftpOpen ? <FolderOpenOutlined /> : <FolderOutlined />,
      label: tab.sftpOpen ? t("term.closeSftp") : t("term.openSftp"),
      disabled: tab.status !== "connected",
      onClick: onToggleSftp,
    },
  ];

  if (!config) {
    return (
      <div className="welcome">
        <Typography.Text type="secondary">{t("term.configDeleted")}</Typography.Text>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        className="term-wrap"
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <div ref={containerRef} className="term-host" />
      </div>
      <div className="term-toolbar">
        <span
          className={`tab-dot ${tab.status === "connecting" ? "connecting" : ""}`}
          style={{ background: STATUS_COLOR[tab.status] }}
        />
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {t(STATUS_KEY[tab.status])}
          {tab.status === "error" && tab.error ? `：${tab.error}` : ""}
        </Typography.Text>
        <span style={{ flex: 1 }} />
        <Tooltip title={t("term.processMgr")}>
          <Button
            size="small"
            type="text"
            icon={<ActivityBoxIcon />}
            disabled={tab.status !== "connected"}
            onClick={() => setProcessOpen(true)}
          />
        </Tooltip>
        {tab.status === "connected" && metrics && (
          <div className="metrics">
            <Tooltip
              placement="topRight"
              title={
                metrics.cpuCores.length > 0 ? (
                  <div className="core-list">
                    {metrics.cpuCores.map((value, index) => (
                      <div key={index} className="core-row">
                        <span className="core-name">C{index}</span>
                        <span className="meter lg">
                          <span
                            className={`meter-fill ${levelClass(value)}`}
                            style={{ width: fillWidth(value) }}
                          />
                        </span>
                        <span className="core-val">{Math.round(value)}%</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  t("term.noCoreData")
                )
              }
            >
              <span className="metric">
                CPU
                <span className="meter sm">
                  <span
                    className={`meter-fill ${levelClass(metrics.cpuTotal)}`}
                    style={{ width: fillWidth(metrics.cpuTotal) }}
                  />
                </span>
                <b className={levelClass(metrics.cpuTotal)}>{Math.round(metrics.cpuTotal)}%</b>
              </span>
            </Tooltip>
            <Tooltip
              placement="topRight"
              title={
                <div className="meter-detail">
                  <span className="meter lg">
                    <span
                      className={`meter-fill ${levelClass(percent(metrics.memUsed, metrics.memTotal))}`}
                      style={{
                        width: fillWidth(percent(metrics.memUsed, metrics.memTotal)),
                      }}
                    />
                  </span>
                  <span className="meter-text">
                    {formatSize(metrics.memUsed)} / {formatSize(metrics.memTotal)} ·{" "}
                    {Math.round(percent(metrics.memUsed, metrics.memTotal))}%
                  </span>
                </div>
              }
            >
              <span className="metric">
                {t("metrics.mem")}
                <span className="meter sm">
                  <span
                    className={`meter-fill ${levelClass(percent(metrics.memUsed, metrics.memTotal))}`}
                    style={{
                      width: fillWidth(percent(metrics.memUsed, metrics.memTotal)),
                    }}
                  />
                </span>
                <b className={levelClass(percent(metrics.memUsed, metrics.memTotal))}>
                  {Math.round(percent(metrics.memUsed, metrics.memTotal))}%
                </b>
              </span>
            </Tooltip>
            <Tooltip
              placement="topRight"
              title={
                <div className="meter-detail">
                  <span className="meter lg">
                    <span
                      className={`meter-fill ${levelClass(percent(metrics.diskUsed, metrics.diskTotal))}`}
                      style={{
                        width: fillWidth(percent(metrics.diskUsed, metrics.diskTotal)),
                      }}
                    />
                  </span>
                  <span className="meter-text">
                    {formatSize(metrics.diskUsed)} / {formatSize(metrics.diskTotal)} ·{" "}
                    {Math.round(percent(metrics.diskUsed, metrics.diskTotal))}%
                  </span>
                </div>
              }
            >
              <span className="metric">
                {t("metrics.disk")}
                <span className="meter sm">
                  <span
                    className={`meter-fill ${levelClass(percent(metrics.diskUsed, metrics.diskTotal))}`}
                    style={{
                      width: `${Math.max(1.5, percent(metrics.diskUsed, metrics.diskTotal))}%`,
                    }}
                  />
                </span>
                <b className={levelClass(percent(metrics.diskUsed, metrics.diskTotal))}>
                  {Math.round(percent(metrics.diskUsed, metrics.diskTotal))}%
                </b>
              </span>
            </Tooltip>
            <Tooltip placement="topRight" title={t("metrics.netTip")}>
              <span className="metric net">
                <span className="rate">↓{formatRate(net.rx)}</span>
                <span className="rate">↑{formatRate(net.tx)}</span>
              </span>
            </Tooltip>
          </div>
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
          <Button size="small" type="text" icon={<ClearOutlined />} onClick={() => termRef.current?.clear()} />
        </Tooltip>
        <Tooltip title={t("term.reconnect")} placement="topRight">
          <Button size="small" type="text" icon={<ThunderboltOutlined />} onClick={onReconnect} />
        </Tooltip>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}

      <ProcessModal
        open={processOpen}
        sessionId={sessionRef.current}
        onClose={() => setProcessOpen(false)}
      />
    </div>
  );
}
