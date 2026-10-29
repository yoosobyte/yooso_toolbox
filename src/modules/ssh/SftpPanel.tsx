import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App as AntdApp,
  Button,
  Empty,
  Input,
  Dropdown,
  Modal,
  Progress,
  Spin,
  Tooltip,
  Typography,
} from "antd";
import {
  CloseOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  DownloadOutlined,
  EditOutlined,
  FileOutlined,
  FolderAddOutlined,
  FolderOutlined,
  LinkOutlined,
  ReloadOutlined,
  UploadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  sftpCopy,
  sftpDownload,
  sftpHome,
  sftpList,
  sftpMkdir,
  sftpRemove,
  sftpRename,
  sftpUpload,
  shellCwd,
} from "../../api";
import type { SftpEntry, TransferItem } from "../../types";
import { copyText } from "../../clipboard";
import { onTerminalOutput } from "../../events";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import ContextMenu from "../../components/ContextMenu";
import type { ContextMenuItem } from "../../components/ContextMenu";
import {
  basename,
  errText,
  formatBytes,
  formatTime,
  joinRemote,
  parentOfRemote,
} from "../../utils";

interface Props {
  sessionId: string | null;
  active?: boolean;
  onClose: () => void;
  /** 面板高度（像素）；拖动分隔条调整 */
  height?: number;
}

type DialogState = { kind: "mkdir" | "rename"; value: string } | null;
type MenuState = {
  x: number;
  y: number;
  target: SftpEntry | null;
  align?: "auto" | "bottom-left";
} | null;

const FOLLOW_KEY = "yooso.sftpFollowCwd";

const sortEntries = (list: SftpEntry[]) =>  [...list].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });

function entryIcon(entry: SftpEntry) {
  if (entry.isDir) return <FolderOutlined className="ico-dir" />;
  if (entry.isSymlink) return <LinkOutlined className="ico-link" />;
  return <FileOutlined className="ico-file" />;
}

export default function SftpPanel({ sessionId, onClose, height }: Props) {
  const { message, modal } = AntdApp.useApp();
  const lang = useUiStore((state) => state.lang);
  const t = useT(lang);
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [initError, setInitError] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<{ path: string; name: string } | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [dragActive, setDragActive] = useState(false);
  const [follow, setFollow] = useState(
    () => localStorage.getItem(FOLLOW_KEY) !== "0",
  );
  const lastFollowCwd = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef("");
  pathRef.current = path;
  const followRef = useRef(follow);
  followRef.current = follow;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const dropRef = useRef<(paths: string[]) => void>(() => undefined);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.path === selected) ?? null,
    [entries, selected],
  );

  /** 面包屑：路径每一段都可点击跳转 */
  const crumbs = useMemo(() => {
    const parts = path.split("/").filter(Boolean);
    const list: { label: string; path: string }[] = path ? [{ label: "/", path: "/" }] : [];
    let acc = "";
    for (const part of parts) {
      acc += `/${part}`;
      list.push({ label: part, path: acc });
    }
    return list;
  }, [path]);

  const loadDir = useCallback(
    async (target: string) => {
      if (!sessionId) return;
      setLoading(true);
      try {
        const list = await sftpList(sessionId, target);
        setEntries(sortEntries(list));
        setPath(target);
        setSelected(null);
      } catch (error) {
        message.error(t("sftp.listFailed", { error: errText(error) }));
      } finally {
        setLoading(false);
      }
    },
    // useT 每次渲染都返回新函数，依赖 lang 即可保证文案随语言更新，同时避免 effect 反复重建
    [sessionId, message, lang],
  );

  /* 建立 SFTP 会话后进入用户主目录 */
  useEffect(() => {
    if (!sessionId) {
      setEntries([]);
      setPath("");
      setInitError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setInitError(null);
    void sftpHome(sessionId)
      .then((home) => {
        if (cancelled) return;
        return loadDir(home);
      })
      .catch((error) => {
        if (cancelled) return;
        setPath("");
        setEntries([]);
        setInitError(errText(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, reloadKey]);

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

  /* 记住「跟随」开关 */
  useEffect(() => {
    localStorage.setItem(FOLLOW_KEY, follow ? "1" : "0");
  }, [follow]);

  const checkCwd = useCallback(async () => {    const sid = sessionIdRef.current;
    if (!followRef.current || !sid) return;
    try {
      const cwd = await shellCwd(sid);
      if (!cwd || cwd === lastFollowCwd.current) return;
      lastFollowCwd.current = cwd;
      // 只在 shell 目录真正变化时跳转，避免把用户手动浏览的目录拉回去
      if (cwd !== pathRef.current) {
        await loadDir(cwd);
      }
    } catch {
      /* 单次读取失败忽略，下次再试 */
    }
  }, [loadDir]);

  /* 兜底轮询（终端没输出时也能同步，例如长时间运行的任务结束后） */
  useEffect(() => {
    if (!follow || !sessionId) return;
    void checkCwd();
    const timer = window.setInterval(() => void checkCwd(), 5000);
    return () => window.clearInterval(timer);
  }, [follow, sessionId, checkCwd]);

  /* 终端一有输出就立即检查：cd 回车后提示符回显即跟随，几乎没有延迟 */
  useEffect(() => {
    if (!follow || !sessionId) return;
    let timer: number | null = null;
    const unsubscribe = onTerminalOutput((sid) => {
      if (sid !== sessionId) return;
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void checkCwd();
      }, 180);
    });
    return () => {
      unsubscribe();
      if (timer != null) window.clearTimeout(timer);
    };
  }, [follow, sessionId, checkCwd]);

  /* 传输结束后自动收起传输列表，把空间还给文件列表（失败的多留几秒便于查看） */
  useEffect(() => {
    if (transfers.length === 0) return;
    if (transfers.some((item) => item.status === "running")) return;
    const hasError = transfers.some((item) => item.status === "error");
    const timer = window.setTimeout(() => setTransfers([]), hasError ? 4000 : 1200);
    return () => window.clearTimeout(timer);
  }, [transfers]);

  const patchTransfer = useCallback(
    (id: string, patch: Partial<TransferItem>) =>
      setTransfers((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item))),
    [],
  );

  const addTransfer = useCallback((name: string, direction: TransferItem["direction"]) => {
    const id = crypto.randomUUID();
    const item: TransferItem = { id, name, direction, percent: 0, status: "running" };
    setTransfers((list) => [item, ...list].slice(0, 10));
    return id;
  }, []);

  /* ---------------- 上传（按钮 / 拖拽共用） ---------------- */

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

  dropRef.current = (paths: string[]) => {
    void uploadPaths(paths);
  };

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

  /* ---------------- 拖拽上传 ---------------- */

  useEffect(() => {
    if (!sessionId) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload as {
          type: string;
          paths?: string[];
          position?: { x: number; y: number };
        };
        if (payload.type === "leave") {
          setDragActive(false);
          return;
        }
        const rect = listRef.current?.getBoundingClientRect();
        const position = payload.position;
        if (!rect || !position) return;

        const scale = window.devicePixelRatio || 1;
        const x = position.x / scale;
        const y = position.y / scale;
        const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

        if (payload.type === "enter" || payload.type === "over") {
          setDragActive(inside);
          return;
        }
        if (payload.type === "drop") {
          setDragActive(false);
          if (inside && payload.paths?.length) {
            dropRef.current(payload.paths);
          }
        }
      })
      .then((unlistenFn) => {
        if (disposed) unlistenFn();
        else unlisten = unlistenFn;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [sessionId]);

  /* ---------------- 下载 / 复制 / 删除 ---------------- */

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
    event: React.MouseEvent,
    target: SftpEntry | null,
    align: "auto" | "bottom-left" = "auto",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (target) setSelected(target.path);
    setMenu({ x: event.clientX, y: event.clientY, target, align });
  };

  const runMenu = (action: () => void) => {
    setMenu(null);
    action();
  };

  /* ---------------- 渲染 ---------------- */

  const menuTarget = menu?.target ?? null;
  const menuItems: ContextMenuItem[] = menuTarget
    ? [
        {
          key: "download",
          icon: <DownloadOutlined />,
          label: t("common.download"),
          disabled: menuTarget.isDir,
          onClick: () => runMenu(() => void downloadEntry(menuTarget)),
        },
        {
          key: "copy",
          icon: <CopyOutlined />,
          label: t("common.copy"),
          onClick: () => runMenu(() => copyEntry(menuTarget)),
        },
        {
          key: "rename",
          icon: <EditOutlined />,
          label: t("common.rename"),
          onClick: () => runMenu(() => setDialog({ kind: "rename", value: menuTarget.name })),
        },
        { type: "divider" as const },
        {
          key: "delete",
          icon: <DeleteOutlined />,
          label: t("common.delete"),
          danger: true,
          onClick: () => runMenu(() => handleDelete(menuTarget)),
        },
      ]
    : [
        {
          key: "paste",
          icon: <CopyOutlined />,
          label: clipboard ? t("sftp.pasteNamed", { name: clipboard.name }) : t("common.paste"),
          disabled: !clipboard,
          onClick: () => runMenu(() => void pasteEntry()),
        },
        { type: "divider" as const },
        {
          key: "mkdir",
          icon: <FolderAddOutlined />,
          label: t("sftp.mkdir"),
          onClick: () => runMenu(() => setDialog({ kind: "mkdir", value: "" })),
        },
        {
          key: "upload-file",
          icon: <UploadOutlined />,
          label: t("sftp.uploadFile"),
          onClick: () => runMenu(() => void uploadViaDialog(false)),
        },
        {
          key: "upload-dir",
          icon: <CloudUploadOutlined />,
          label: t("sftp.uploadDir"),
          onClick: () => runMenu(() => void uploadViaDialog(true)),
        },
        { type: "divider" as const },
        {
          key: "refresh",
          icon: <ReloadOutlined />,
          label: t("common.refresh"),
          onClick: () => runMenu(() => void loadDir(path)),
        },
      ];

  return (
    <section
      className="sftp-panel"
      style={height ? { height } : undefined}
      onContextMenu={(event) => openMenu(event, null)}
    >
      <div className="sftp-head">
        <div className="sftp-path-row">
          {crumbs.length > 0 ? (
            <nav className="sftp-crumbs" title={path}>
              {crumbs.map((crumb, index) => (
                <Fragment key={crumb.path}>
                  {index > 1 && <span className="crumb-sep">/</span>}
                  <button
                    type="button"
                    className={`crumb${index === crumbs.length - 1 ? " current" : ""}`}
                    onClick={() => void loadDir(crumb.path)}
                  >
                    {crumb.label}
                  </button>
                </Fragment>
              ))}
            </nav>
          ) : (
            <span className="sftp-path" title={initError || undefined}>
              {initError
                ? t("sftp.initFailed")
                : sessionId
                  ? t("sftp.connecting")
                  : t("sftp.disconnected")}
            </span>
          )}
          <button
            type="button"
            className="path-copy"
            disabled={!path}
            onClick={async () => {
              try {
                await copyText(path);
                message.success(t("sftp.pathCopied"));
              } catch {
                message.error(t("sftp.copyFailed"));
              }
            }}
          >
            {t("sftp.copyPath")}
          </button>
        </div>
        <Tooltip title={follow ? t("sftp.followOn") : t("sftp.followOff")}>
          <Button
            size="small"
            type="text"
            icon={follow ? <LinkOutlined /> : <DisconnectOutlined />}
            disabled={!sessionId}
            onClick={() => setFollow((value) => !value)}
          />
        </Tooltip>
        <Tooltip title={t("common.refresh")}>
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            disabled={!sessionId}
            loading={loading}
            onClick={() => void loadDir(path)}
          />
        </Tooltip>
        <Tooltip title={t("sftp.mkdir")}>
          <Button
            size="small"
            type="text"
            icon={<FolderAddOutlined />}
            disabled={!sessionId}
            onClick={() => setDialog({ kind: "mkdir", value: "" })}
          />
        </Tooltip>
        <Dropdown
          trigger={["click"]}
          placement="topRight"
          disabled={!sessionId}
          menu={{
            items: [
              { key: "file", icon: <UploadOutlined />, label: t("sftp.uploadFile") },
              { key: "dir", icon: <FolderAddOutlined />, label: t("sftp.uploadDir") },
            ],
            onClick: ({ key }) => void uploadViaDialog(key === "dir"),
          }}
        >
          <Button
            size="small"
            type="text"
            icon={<CloudUploadOutlined />}
            disabled={!sessionId}
          />
        </Dropdown>
        <Tooltip title={t("sftp.close")} placement="topRight">
          <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClose} />
        </Tooltip>
      </div>

      <div className="sftp-body">
        <div
          className="sftp-list"
          ref={listRef}
          onContextMenu={(event) => openMenu(event, null, "bottom-left")}
        >
        <div className="sftp-list-head">
          <span>{t("sftp.name")}</span>
          <span>{t("sftp.perm")}</span>
          <span>{t("sftp.size")}</span>
          <span>{t("sftp.mtime")}</span>
        </div>

        {path && path !== "/" && (
          <div
            className="sftp-row up-row"
            onDoubleClick={goUp}
            onContextMenu={(event) => openMenu(event, null)}
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
              description={<span style={{ fontSize: 12 }}>{t("sftp.waitConnect")}</span>}
            />
          </div>
        ) : initError && !path ? (
          <div className="sftp-error">
            <div className="sftp-error-title">
              <WarningOutlined />
              {t("sftp.initFailed")}
            </div>
            <div className="sftp-error-msg">{initError}</div>
            <Button size="small" type="primary" onClick={() => setReloadKey((key) => key + 1)}>
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
              onClick={() => setSelected(entry.path)}
              onDoubleClick={() => {
                if (entry.isDir) void loadDir(entry.path);
                else void downloadEntry(entry);
              }}
              onContextMenu={(event) => openMenu(event, entry)}
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

        {dragActive && (
          <div className="sftp-drop">
            <CloudUploadOutlined />
            <span>{t("sftp.dropHint", { path: path || t("sftp.currentDir") })}</span>
            <span className="sftp-drop-hint">{t("sftp.dropSub")}</span>
          </div>
        )}
      </div>

      {transfers.length > 0 && (
        <div className="transfers">
          <div style={{ display: "flex", alignItems: "center", marginBottom: 2 }}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {t("sftp.transfers")}
            </Typography.Text>
            <span style={{ flex: 1 }} />
            <Button
              type="text"
              size="small"
              style={{ fontSize: 11 }}
              onClick={() => setTransfers([])}
            >
              {t("sftp.clear")}
            </Button>
          </div>
          {transfers.map((item) => (
            <div className="transfer-item" key={item.id}>
              <div className="transfer-line">
                <span>{item.direction === "upload" ? "↑" : "↓"}</span>
                <span className="transfer-name" title={item.name}>
                  {item.name}
                </span>
                <span style={{ color: item.status === "error" ? "#f87171" : "#8b9bb4" }}>
                  {item.status === "done"
                    ? t("sftp.done")
                    : item.status === "error"
                      ? t("sftp.failed")
                      : `${item.percent.toFixed(0)}%`}
                </span>
              </div>
              <Progress
                percent={Math.round(item.percent)}
                size={{ height: 3 }}
                showInfo={false}
                status={
                  item.status === "error" ? "exception" : item.status === "done" ? "success" : "active"
                }
                strokeColor={item.status === "error" ? "#ef4444" : "#3b82f6"}
              />
            </div>
          ))}
        </div>
      )}

      <Modal
        open={dialog !== null}
        title={dialog?.kind === "mkdir" ? t("sftp.mkdir") : t("common.rename")}
        onCancel={() => setDialog(null)}
        onOk={() => void handleDialogSubmit()}
        confirmLoading={submitting}
        okText={t("common.confirm")}
        cancelText={t("common.cancel")}
        width={380}
      >
        <Input
          autoFocus
          value={dialog?.value ?? ""}
          placeholder={dialog?.kind === "mkdir" ? t("sftp.enterName") : t("sftp.newName")}
          onChange={(event) =>
            setDialog((state) => (state ? { ...state, value: event.target.value } : state))
          }
          onPressEnter={() => void handleDialogSubmit()}
        />
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {t("sftp.location", { path })}
        </Typography.Text>
      </Modal>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          align={menu.align}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}
