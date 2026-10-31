import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { App as AntdApp } from "antd";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

import {
  sftpCopy,
  sftpDownload,
  sftpMkdir,
  sftpRemove,
  sftpRename,
  sftpUpload,
} from "../../api";
import { useT } from "../../i18n";
import { useUiStore } from "../../stores/uiStore";
import type { SftpEntry } from "../../types";
import { basename, errText, joinRemote, parentOfRemote } from "../../utils";
import SftpContextMenu from "./sftp/SftpContextMenu";
import SftpFileList from "./sftp/SftpFileList";
import SftpNameDialog from "./sftp/SftpNameDialog";
import SftpToolbar from "./sftp/SftpToolbar";
import SftpTransfers from "./sftp/SftpTransfers";
import type { SftpDialogState, SftpMenuAlign, SftpMenuState } from "./sftp/types";
import { useSftpDirectory } from "./sftp/useSftpDirectory";
import { useSftpDragDrop } from "./sftp/useSftpDragDrop";
import { useSftpFollowCwd } from "./sftp/useSftpFollowCwd";
import { useSftpTransfers } from "./sftp/useSftpTransfers";

interface Props {
  sessionId: string | null;
  active?: boolean;
  onClose: () => void;
  /** 面板高度（像素）；拖动分隔条调整 */
  height?: number;
}

export default function SftpPanel({ sessionId, onClose, height }: Props) {
  const { message, modal } = AntdApp.useApp();
  const lang = useUiStore((state) => state.lang);
  const t = useT(lang);

  const { path, entries, loading, selected, setSelected, initError, loadDir, retry } =
    useSftpDirectory(sessionId);
  const { transfers, addTransfer, patchTransfer, clearTransfers } = useSftpTransfers();
  const { follow, setFollow } = useSftpFollowCwd(sessionId, path, loadDir);

  const [dialog, setDialog] = useState<SftpDialogState>(null);
  const [submitting, setSubmitting] = useState(false);
  const [clipboard, setClipboard] = useState<{ path: string; name: string } | null>(null);
  const [menu, setMenu] = useState<SftpMenuState>(null);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.path === selected) ?? null,
    [entries, selected],
  );

  /* 右键菜单：点击别处 / Esc / 窗口失焦时关闭 */
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const uploadPaths = useCallback(
    async (paths: string[]) => {
      if (!sessionId || !path) return;
      for (const localPath of paths) {
        const name = basename(localPath);
        const id = addTransfer(name, "upload");
        try {
          await sftpUpload(sessionId, localPath, path, (event) => {
            if (event.type === "progress") {
              const percent = event.total > 0 ? (event.transferred / event.total) * 100 : 0;
              patchTransfer(id, { percent: Math.min(99, percent) });
            } else if (event.type === "done") {
              patchTransfer(id, { percent: 100, status: "done" });
            } else {
              patchTransfer(id, { status: "error", message: event.message });
            }
          });
          patchTransfer(id, { percent: 100, status: "done" });
        } catch (error) {
          patchTransfer(id, { status: "error", message: errText(error) });
          message.error(t("sftp.uploadFailed", { name, error: errText(error) }));
        }
      }
      await loadDir(path);
    },
    [sessionId, path, addTransfer, patchTransfer, message, loadDir, lang],
  );

  const { dragActive, listRef } = useSftpDragDrop(sessionId, (paths) => {
    void uploadPaths(paths);
  });

  const uploadViaDialog = async (directory: boolean) => {
    if (!sessionId) return;
    let picked: string[] | string | null = null;
    try {
      picked = await openDialog(
        directory
          ? { title: t("sftp.uploadDirTitle"), multiple: false, directory: true }
          : { title: t("sftp.uploadFileTitle"), multiple: true, directory: false },
      );
    } catch (error) {
      message.error(t("sftp.openPickerFailed", { error: errText(error) }));
      return;
    }
    if (!picked) return;
    await uploadPaths(Array.isArray(picked) ? picked : [picked]);
  };

  const downloadEntry = async (entry: SftpEntry) => {
    if (!sessionId || entry.isDir) return;
    let target: string | null = null;
    try {
      target = await saveDialog({ title: t("sftp.saveTo"), defaultPath: entry.name });
    } catch (error) {
      message.error(t("sftp.saveDialogFailed", { error: errText(error) }));
      return;
    }
    if (!target) return;
    const id = addTransfer(entry.name, "download");
    try {
      await sftpDownload(sessionId, entry.path, target, (event) => {
        if (event.type === "progress") {
          const percent = event.total > 0 ? (event.transferred / event.total) * 100 : 0;
          patchTransfer(id, { percent: Math.min(99, percent) });
        } else if (event.type === "done") {
          patchTransfer(id, { percent: 100, status: "done" });
        } else {
          patchTransfer(id, { status: "error", message: event.message });
        }
      });
      patchTransfer(id, { percent: 100, status: "done" });
      message.success(t("sftp.downloadDone", { path: target }));
    } catch (error) {
      patchTransfer(id, { status: "error", message: errText(error) });
      message.error(t("sftp.downloadFailed", { error: errText(error) }));
    }
  };

  const copyEntry = (entry: SftpEntry) => {
    setClipboard({ path: entry.path, name: entry.name });
    message.success(t("sftp.copyEntryDone", { name: entry.name }));
  };

  const pasteEntry = async () => {
    if (!sessionId || !clipboard) return;
    try {
      await sftpCopy(sessionId, clipboard.path, path);
      message.success(t("sftp.pasteDone", { name: clipboard.name }));
      await loadDir(path);
    } catch (error) {
      message.error(t("sftp.pasteFailed", { error: errText(error) }));
    }
  };

  const handleDelete = (entry: SftpEntry) => {
    if (!sessionId) return;
    modal.confirm({
      title: entry.isDir ? t("sftp.deleteTitle") : t("sftp.deleteFileTitle"),
      content: entry.isDir
        ? t("sftp.deleteDirConfirm", { name: entry.name })
        : t("sftp.deleteConfirm", { name: entry.name }),
      okText: t("common.delete"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          await sftpRemove(sessionId, entry.path, entry.isDir);
          message.success(t("sftp.deleted"));
          await loadDir(path);
        } catch (error) {
          message.error(t("sftp.deleteFailed", { error: errText(error) }));
        }
      },
    });
  };

  const handleDialogSubmit = async () => {
    if (!sessionId || !dialog) return;
    const value = dialog.value.trim();
    if (!value) {
      message.warning(t("sftp.nameRequired"));
      return;
    }
    if (value.includes("/")) {
      message.warning(t("sftp.nameNoSlash"));
      return;
    }
    setSubmitting(true);
    try {
      if (dialog.kind === "mkdir") {
        await sftpMkdir(sessionId, joinRemote(path, value));
        message.success(t("sftp.mkdirDone"));
      } else if (selectedEntry) {
        await sftpRename(sessionId, selectedEntry.path, joinRemote(path, value));
        message.success(t("sftp.renamed"));
      }
      setDialog(null);
      await loadDir(path);
    } catch (error) {
      message.error(t("sftp.opFailed", { error: errText(error) }));
    } finally {
      setSubmitting(false);
    }
  };

  const goUp = () => {
    if (!path || path === "/") return;
    void loadDir(parentOfRemote(path));
  };

  const openMenu = (
    event: MouseEvent<HTMLElement>,
    target: SftpEntry | null,
    align: SftpMenuAlign = "auto",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (target) setSelected(target.path);
    setMenu({ x: event.clientX, y: event.clientY, target, align });
  };

  return (
    <section
      className="sftp-panel"
      style={height ? { height } : undefined}
      onContextMenu={(event) => openMenu(event, null)}
    >
      <SftpToolbar
        sessionId={sessionId}
        path={path}
        initError={initError}
        follow={follow}
        loading={loading}
        onNavigate={(target) => void loadDir(target)}
        onToggleFollow={() => setFollow((value) => !value)}
        onRefresh={() => void loadDir(path)}
        onCreateDir={() => setDialog({ kind: "mkdir", value: "" })}
        onUpload={(directory) => void uploadViaDialog(directory)}
        onClose={onClose}
      />

      <SftpFileList
        sessionId={sessionId}
        path={path}
        entries={entries}
        loading={loading}
        selected={selected}
        initError={initError}
        dragActive={dragActive}
        listRef={listRef}
        onSelect={setSelected}
        onOpenDir={(target) => void loadDir(target)}
        onDownload={(entry) => void downloadEntry(entry)}
        onGoUp={goUp}
        onRetry={retry}
        onOpenMenu={openMenu}
      />

      {transfers.length > 0 && <SftpTransfers transfers={transfers} onClear={clearTransfers} />}

      <SftpNameDialog
        dialog={dialog}
        submitting={submitting}
        path={path}
        onChange={(value) =>
          setDialog((state) => (state ? { ...state, value } : state))
        }
        onCancel={() => setDialog(null)}
        onSubmit={() => void handleDialogSubmit()}
      />

      {menu && (
        <SftpContextMenu
          menu={menu}
          clipboard={clipboard}
          onClose={() => setMenu(null)}
          onDownload={(entry) => void downloadEntry(entry)}
          onCopy={copyEntry}
          onRename={(entry) => setDialog({ kind: "rename", value: entry.name })}
          onDelete={handleDelete}
          onPaste={() => void pasteEntry()}
          onCreateDir={() => setDialog({ kind: "mkdir", value: "" })}
          onUpload={(directory) => void uploadViaDialog(directory)}
          onRefresh={() => void loadDir(path)}
        />
      )}
    </section>
  );
}
