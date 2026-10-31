import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  ExportOutlined,
  LinkOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { FileEntry } from "../../types";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";

interface Props {
  x: number;
  y: number;
  entry: FileEntry | null;
  onOpen: () => void;
  onReveal: () => void;
  onOpenLocation: () => void;
  onCopyFiles: () => void;
  onCopyPath: () => void;
  onRename: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}

/** 文件列表右键菜单：条目菜单 + 空白处菜单 */
export default function FilesContextMenu({
  x,
  y,
  entry,
  onOpen,
  onReveal,
  onOpenLocation,
  onCopyFiles,
  onCopyPath,
  onRename,
  onDelete,
  onRefresh,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <div
      className="files-menu"
      style={{ left: x, top: y }}
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
            <ExportOutlined />
            {t("files.reveal")}
          </button>
          {!entry.isDir && (
            <button type="button" onClick={onOpenLocation}>
              <FolderOpenOutlined />
              {t("files.openLocation")}
            </button>
          )}
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
