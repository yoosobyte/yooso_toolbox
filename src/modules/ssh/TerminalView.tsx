import { useEffect, useRef, useState } from "react";
import { App as AntdApp, Typography } from "antd";
import "@xterm/xterm/css/xterm.css";
import { sshConnect, sshDisconnect, sshForgetHost, sshResize, sshWrite } from "../../api";
import { base64ToBytes, textToBase64 } from "../../base64";
import { copyText } from "../../clipboard";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import type { SessionConfig, TermTab } from "../../types";
import { errText } from "../../utils";
import { emitTerminalOutput } from "../../events";
import { createXterm, installClipboardKeyHandler, useXterm } from "./useXterm";
import { useTerminalMetrics } from "./useTerminalMetrics";
import TerminalContextMenu from "./TerminalContextMenu";
import TerminalToolbar from "./TerminalToolbar";
import ProcessModal from "./ProcessModal";

interface Props {
  tab: TermTab;
  active: boolean;
  config?: SessionConfig;
  onSession: (tabId: string, sessionId: string | null) => void;
  onReconnect: () => void;
  onToggleSftp: () => void;
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
  const { termRef, fitRef } = useXterm();
  const sessionRef = useRef<string | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [processOpen, setProcessOpen] = useState(false);
  const t = useT(useUiStore((state) => state.lang));
  const [sid, setSid] = useState<string | null>(null);
  const { metrics, net } = useTerminalMetrics(sid, active);

  const { message, modal } = AntdApp.useApp();
  const setStatus = useWorkspaceStore((state) => state.setStatus);

  /* ---------------- 建立终端 + 连接（attempt 变化时重建） ---------------- */
  useEffect(() => {
    const container = containerRef.current;
    const sessionConfig = configRef.current;
    if (!container || !sessionConfig) return;

    let disposed = false;
    let flushTimer: number | null = null;
    let pending = "";

    const { term, fit } = createXterm(container);
    termRef.current = term;
    fitRef.current = fit;
    installClipboardKeyHandler(term);

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
        const reason = errText(error);
        setStatus(tab.id, "error", reason);
        term.writeln(`\r\n\x1b[38;5;203m✘ ${t("term.connectFailed")}${reason}\x1b[0m`);
        if (reason.includes("主机密钥已变更")) {
          modal.confirm({
            title: t("term.hostKeyChanged"),
            content: (
              <div className="ssh-hostkey-change">
                <p>{t("term.hostKeyChangedHint")}</p>
                <pre>{reason}</pre>
              </div>
            ),
            okText: t("term.hostKeyTrust"),
            cancelText: t("common.cancel"),
            onOk: async () => {
              await sshForgetHost(sessionConfig.host, sessionConfig.port);
              message.success(t("term.hostKeyTrusted"));
              onReconnect();
            },
          });
        }
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

  /* ---------------- 切到该标签时重新适配尺寸 ---------------- */
  useEffect(() => {
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
      <TerminalToolbar
        tab={tab}
        metrics={metrics}
        net={net}
        onOpenProcesses={() => setProcessOpen(true)}
        onToggleSftp={onToggleSftp}
        onClear={() => termRef.current?.clear()}
        onReconnect={onReconnect}
      />

      {menu && (
        <TerminalContextMenu
          x={menu.x}
          y={menu.y}
          tab={tab}
          getTerminal={() => termRef.current}
          onClose={() => setMenu(null)}
          onReconnect={onReconnect}
          onToggleSftp={onToggleSftp}
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
