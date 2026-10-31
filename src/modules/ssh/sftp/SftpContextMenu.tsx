import {
  CloudUploadOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FolderAddOutlined,
  ReloadOutlined,
  UploadOutlined,
} from "@ant-design/icons";

import ContextMenu from "../../../components/ContextMenu";
import type { ContextMenuItem } from "../../../components/ContextMenu";
import { useT } from "../../../i18n";
import { useUiStore } from "../../../stores/uiStore";
import type { SftpEntry } from "../../../types";
import type { SftpMenuState } from "./types";

interface Props {
  menu: NonNullable<SftpMenuState>;
  clipboard: { path: string; name: string } | null;
  onClose: () => void;
  onDownload: (entry: SftpEntry) => void;
  onCopy: (entry: SftpEntry) => void;
  onRename: (entry: SftpEntry) => void;
  onDelete: (entry: SftpEntry) => void;
  onPaste: () => void;
  onCreateDir: () => void;
  onUpload: (directory: boolean) => void;
  onRefresh: () => void;
}

/** SFTP 右键菜单：条目菜单（下载/复制/重命名/删除）与空白处菜单（粘贴/新建/上传/刷新）。 */
export default function SftpContextMenu({
  menu,
  clipboard,
  onClose,
  onDownload,
  onCopy,
  onRename,
  onDelete,
  onPaste,
  onCreateDir,
  onUpload,
  onRefresh,
}: Props) {
  const lang = useUiStore((state) => state.lang);
  const t = useT(lang);

  const menuTarget = menu.target;

  const runMenu = (action: () => void) => {
    onClose();
    action();
  };

  const menuItems: ContextMenuItem[] = menuTarget
    ? [
        {
          key: "download",
          icon: <DownloadOutlined />,
          label: t("common.download"),
          disabled: menuTarget.isDir,
          onClick: () => runMenu(() => onDownload(menuTarget)),
        },
        {
          key: "copy",
          icon: <CopyOutlined />,
          label: t("common.copy"),
          onClick: () => runMenu(() => onCopy(menuTarget)),
        },
        {
          key: "rename",
          icon: <EditOutlined />,
          label: t("common.rename"),
          onClick: () => runMenu(() => onRename(menuTarget)),
        },
        { type: "divider" as const },
        {
          key: "delete",
          icon: <DeleteOutlined />,
          label: t("common.delete"),
          danger: true,
          onClick: () => runMenu(() => onDelete(menuTarget)),
        },
      ]
    : [
        {
          key: "paste",
          icon: <CopyOutlined />,
          label: clipboard ? t("sftp.pasteNamed", { name: clipboard.name }) : t("common.paste"),
          disabled: !clipboard,
          onClick: () => runMenu(onPaste),
        },
        { type: "divider" as const },
        {
          key: "mkdir",
          icon: <FolderAddOutlined />,
          label: t("sftp.mkdir"),
          onClick: () => runMenu(onCreateDir),
        },
        {
          key: "upload-file",
          icon: <UploadOutlined />,
          label: t("sftp.uploadFile"),
          onClick: () => runMenu(() => onUpload(false)),
        },
        {
          key: "upload-dir",
          icon: <CloudUploadOutlined />,
          label: t("sftp.uploadDir"),
          onClick: () => runMenu(() => onUpload(true)),
        },
        { type: "divider" as const },
        {
          key: "refresh",
          icon: <ReloadOutlined />,
          label: t("common.refresh"),
          onClick: () => runMenu(onRefresh),
        },
      ];

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      align={menu.align}
      items={menuItems}
      onClose={onClose}
    />
  );
}
