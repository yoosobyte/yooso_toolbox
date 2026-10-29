import { useEffect, useRef, useState } from "react";
import { Typography } from "antd";
import { CloseOutlined, CloudServerOutlined } from "@ant-design/icons";
import TerminalView from "./TerminalView";
import SftpPanel from "./SftpPanel";
import { STATUS_COLOR } from "./status";
import { useSessionStore } from "../../stores/sessionStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import type { TermTab } from "../../types";

interface Props {
  /** 保留：占位，方便后续在欢迎页挂快捷入口 */
  onCreate?: () => void;
}

const MIN_SFTP_HEIGHT = 150;
const SFTP_HEIGHT_KEY = "yooso.sftpHeight";

/** 当前平台是否 macOS（决定快捷键提示显示 ⌘ 还是 Ctrl） */
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function TabLabel({ tab, onClose }: { tab: TermTab; onClose: () => void }) {
  const t = useT(useUiStore((state) => state.lang));
  return (
    <span className="tab-label">
      <span
        className={`tab-dot${tab.status === "connecting" ? " connecting" : ""}`}
        style={{ background: STATUS_COLOR[tab.status] }}
      />
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={tab.subtitle}
      >
        {tab.title}
      </span>
      <button
        type="button"
        className="tab-close"
        title={t("term.closeTab")}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <CloseOutlined />
      </button>
    </span>
  );
}

export default function TerminalTabs(_props: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeId = useWorkspaceStore((state) => state.activeId);
  const setActive = useWorkspaceStore((state) => state.setActive);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const reconnect = useWorkspaceStore((state) => state.reconnect);
  const toggleSftp = useWorkspaceStore((state) => state.toggleSftp);

  const sessions = useSessionStore((state) => state.sessions);
  const sessionsLoaded = useSessionStore((state) => state.loaded);
  const loadSessions = useSessionStore((state) => state.load);

  const [sessionIds, setSessionIds] = useState<Record<string, string | null>>({});
  const [sftpHeight, setSftpHeight] = useState(() => {
    const raw = localStorage.getItem(SFTP_HEIGHT_KEY);
    const value = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(value) && value >= MIN_SFTP_HEIGHT ? value : 280;
  });
  const panesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionsLoaded) void loadSessions();
  }, [sessionsLoaded, loadSessions]);

  useEffect(() => {
    localStorage.setItem(SFTP_HEIGHT_KEY, String(Math.round(sftpHeight)));
  }, [sftpHeight]);

  const handleSession = (tabId: string, sessionId: string | null) => {
    setSessionIds((prev) => {
      if (prev[tabId] === sessionId) return prev;
      return { ...prev, [tabId]: sessionId };
    });
  };

  /** 拖动分隔条调整 SFTP 面板高度（面板在下方，向上拖动变大） */
  const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = sftpHeight;
    const containerHeight = panesRef.current?.clientHeight ?? 640;
    const maxHeight = Math.max(MIN_SFTP_HEIGHT, containerHeight - 140);

    document.body.classList.add("sftp-resizing");
    const onMove = (moveEvent: MouseEvent) => {
      const next = startHeight - (moveEvent.clientY - startY);
      setSftpHeight(Math.min(maxHeight, Math.max(MIN_SFTP_HEIGHT, next)));
    };
    const onUp = () => {
      document.body.classList.remove("sftp-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (tabs.length === 0) {
    return (
      <div className="welcome">
        <div className="welcome-card">
          <div className="welcome-glyph">
            <CloudServerOutlined />
          </div>
          <Typography.Title level={4} style={{ margin: "0 0 6px" }}>
            {t("term.welcomeTitle")}
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12.5 }}>
            {t("term.welcomeDesc")}
          </Typography.Paragraph>
          <div className="welcome-tips">
            <div className="welcome-tip">
              {isMac ? (
                <>
                  <kbd>⌘</kbd> + <kbd>C</kbd> {t("term.hintCopy")}
                </>
              ) : (
                <>
                  <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> {t("term.hintCopy")}
                </>
              )}
            </div>
            <div className="welcome-tip">
              {isMac ? (
                <>
                  <kbd>⌘</kbd> + <kbd>V</kbd> {t("term.hintPaste")}
                </>
              ) : (
                <>
                  <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>V</kbd> {t("term.hintPaste")}
                </>
              )}
            </div>
            <div className="welcome-tip">{t("term.hintSftp")}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-tabs">
      <div className="tab-bar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab-item${tab.id === activeId ? " active" : ""}`}
            onClick={() => setActive(tab.id)}
            onAuxClick={(event) => {
              if (event.button === 1) closeTab(tab.id);
            }}
            title={`${tab.title} · ${tab.subtitle}`}
          >
            <TabLabel tab={tab} onClose={() => closeTab(tab.id)} />
          </div>
        ))}
      </div>

      <div className="tab-panes" ref={panesRef}>
        {tabs.map((tab) => {
          const config = sessions.find((item) => item.id === tab.configId);
          const isActive = tab.id === activeId || (!activeId && tab.id === tabs[0].id);
          return (
            <div
              className="tab-pane"
              key={tab.id}
              style={{ display: isActive ? "flex" : "none" }}
            >
              <TerminalView
                tab={tab}
                active={isActive}
                config={config}
                onSession={handleSession}
                onReconnect={() => reconnect(tab.id)}
                onToggleSftp={() => toggleSftp(tab.id)}
              />
              {tab.sftpOpen && (
                <>
                  <div
                    className="sftp-resizer"
                    onMouseDown={startResize}
                    title={t("term.resizeHint")}
                  />
                  <SftpPanel
                    sessionId={sessionIds[tab.id] ?? null}
                    height={sftpHeight}
                    onClose={() => toggleSftp(tab.id)}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
