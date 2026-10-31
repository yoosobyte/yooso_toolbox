import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useLayoutEffect, useRef, useState } from "react";
import type { FileEntry } from "../../types";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";

interface Props {
  x: number;
  y: number;
  entry: FileEntry | null;
  onOpen: () => void;
  onReveal: () => void;
  onCopyFiles: () => void;
  onCopyPath: () => void;
  onRename: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}

/** 文件列表右键菜单：条目菜单 + 空白处菜单 */
const IS_MAC = /mac/i.test(navigator.userAgent);

export default function FilesContextMenu({
  x,
  y,
  entry,
  onOpen,
  onReveal,
  onCopyFiles,
  onCopyPath,
  onRename,
  onDelete,
  onRefresh,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // 默认从鼠标位置向右下展开；贴近窗口右/下边缘时翻转，避免跑出屏幕
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 4;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, x - rect.width);
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, y - rect.height);
    }
    setPos({ left, top });
  }, [x, y, entry]);

  return (
    <div
      ref={menuRef}
      className="files-menu"
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {entry ? (
        <>
          <button type="button" onClick={onOpen}>
            <FolderOpenOutlined />
            {entry.isDir ? t("files.openFolder") : t("files.open")}
          </button>
          <button type="button" onClick={onReveal}>
            <FolderOpenOutlined />
            {IS_MAC ? t("files.revealFinder") : t("files.revealExplorer")}
          </button>
          <button type="button" onClick={onCopyFiles}>
            <CopyOutlined />
            {t("files.copy")}
          </button>
          <button type="button" onClick={onCopyPath}>
            <LinkOutlined />
            {t("files.copyPath")}
          </button>
          <button type="button" onClick={onRename}>
            <EditOutlined />
            {t("files.rename")}
          </button>
          <button type="button" className="danger" onClick={onDelete}>
            <DeleteOutlined />
            {t("files.delete")}
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={onRefresh}>
            <ReloadOutlined />
            {t("files.refresh")}
          </button>
          <button type="button" onClick={onCopyPath}>
            <CopyOutlined />
            {t("files.copyCurrentPath")}
          </button>
        </>
      )}
    </div>
  );
}
