import type { MouseEvent, RefObject } from "react";
import { Button, Empty, Spin } from "antd";
import {
  CloudUploadOutlined,
  FileOutlined,
  FolderOutlined,
  LinkOutlined,
  WarningOutlined,
} from "@ant-design/icons";

import { useT } from "../../../i18n";
import { useUiStore } from "../../../stores/uiStore";
import type { SftpEntry } from "../../../types";
import { formatBytes, formatTime } from "../../../utils";
import type { SftpMenuAlign } from "./types";

interface Props {
  sessionId: string | null;
  path: string;
  entries: SftpEntry[];
  loading: boolean;
  selected: string | null;
  initError: string | null;
  dragActive: boolean;
  listRef: RefObject<HTMLDivElement | null>;
  onSelect: (path: string) => void;
  onOpenDir: (path: string) => void;
  onDownload: (entry: SftpEntry) => void;
  onGoUp: () => void;
  onRetry: () => void;
  onOpenMenu: (
    event: MouseEvent<HTMLElement>,
    target: SftpEntry | null,
    align?: SftpMenuAlign,
  ) => void;
}

function entryIcon(entry: SftpEntry) {
  if (entry.isDir) return <FolderOutlined className="ico-dir" />;
  if (entry.isSymlink) return <LinkOutlined className="ico-link" />;
  return <FileOutlined className="ico-file" />;
}

/** SFTP 文件列表：列头、返回上级、加载 / 空 / 错误状态、条目行与拖拽提示层。 */
export default function SftpFileList({
  sessionId,
  path,
  entries,
  loading,
  selected,
  initError,
  dragActive,
  listRef,
  onSelect,
  onOpenDir,
  onDownload,
  onGoUp,
  onRetry,
  onOpenMenu,
}: Props) {
  const lang = useUiStore((state) => state.lang);
  const t = useT(lang);

  return (
    <div className="sftp-body">
      <div
        className="sftp-list"
        ref={listRef}
        onContextMenu={(event) => onOpenMenu(event, null, "bottom-left")}
      >
        <div className="sftp-list-head">
          <span>{t("sftp.name")}</span>
          <span>{t("sftp.perm")}</span>
          <span>{t("sftp.size")}</span>
          <span>{t("sftp.mtime")}</span>
        </div>

        {/* 只有这块区域滚动：表头固定在上面，滚动条也只出现在数据区 */}
        <div className="sftp-rows">
          {path && path !== "/" && (
            <div
              className="sftp-row up-row"
              onDoubleClick={onGoUp}
              onContextMenu={(event) => onOpenMenu(event, null)}
              title={t("sftp.goUpHint")}
            >
              <span className="name">
                <span className="ico">
                  <FolderOutlined className="ico-dir" />
                </span>
                <span className="text">..</span>
              </span>
              <span className="perm">-</span>
              <span className="size">-</span>
              <span className="time">-</span>
            </div>
          )}

          {!sessionId ? (
            <div className="sftp-empty">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span style={{ fontSize: 12 }}>{t("sftp.waitConnect")}</span>
                }
              />
            </div>
          ) : initError && !path ? (
            <div className="sftp-error">
              <div className="sftp-error-title">
                <WarningOutlined />
                {t("sftp.initFailed")}
              </div>
              <div className="sftp-error-msg">{initError}</div>
              <Button size="small" type="primary" onClick={onRetry}>
                {t("sftp.retry")}
              </Button>
            </div>
          ) : loading && entries.length === 0 ? (
            <div className="sftp-empty" style={{ textAlign: "center" }}>
              <Spin size="small" />
            </div>
          ) : entries.length === 0 ? (
            <div className="sftp-empty">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span style={{ fontSize: 12 }}>{t("sftp.emptyDir")}</span>
                }
              />
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.path}
                className={`sftp-row${selected === entry.path ? " selected" : ""}`}
                onClick={() => onSelect(entry.path)}
                onDoubleClick={() => {
                  if (entry.isDir) onOpenDir(entry.path);
                  else onDownload(entry);
                }}
                onContextMenu={(event) => onOpenMenu(event, entry)}
                title={entry.path}
              >
                <span className="name">
                  <span className="ico">{entryIcon(entry)}</span>
                  <span className="text">{entry.name}</span>
                </span>
                <span className="perm">{entry.permissions ?? "-"}</span>
                <span className="size">{entry.isDir ? "-" : formatBytes(entry.size)}</span>
                <span className="time">{formatTime(entry.modified)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {dragActive && (
        <div className="sftp-drop">
          <CloudUploadOutlined />
          <span>{t("sftp.dropHint", { path: path || t("sftp.currentDir") })}</span>
          <span className="sftp-drop-hint">{t("sftp.dropSub")}</span>
        </div>
      )}
    </div>
  );
}
