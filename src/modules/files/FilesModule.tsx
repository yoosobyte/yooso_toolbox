import { useDeferredValue, useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { App as AntdApp, Button, Input, Modal, Tooltip, Typography } from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import {
  fsCopyToClipboard,
  fsDelete,
  fsIndexBuild,
  fsIndexStatus,
  fsOpenPath,
  fsRename,
  fsRevealPath,
  fsRoots,
  fsSearch,
} from "../../api";
import { copyText } from "../../clipboard";
import { useT } from "../../i18n";
import { useUiStore } from "../../stores/uiStore";
import type { FileEntry, FileRoot, IndexStatus } from "../../types";
import { errText, formatBytes } from "../../utils";
import { FilesNavIcon } from "../../components/NavIcons";
import FilesContextMenu from "./FilesContextMenu";
import { fileIcon, rootIcon } from "./fileIcons";

function parentOf(path: string): string {
  return path.replace(/[\\/][^\\/]+$/, "");
}

function Highlight({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  const index = text.toLowerCase().indexOf(needle);
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="files-hit">{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  );
}

/** Everything 风格：后台建立文件索引，输入文件名直接查内存索引 */
export default function FilesModule() {
  const t = useT(useUiStore((state) => state.lang));
  const { message, modal } = AntdApp.useApp();

  const [roots, setRoots] = useState<FileRoot[]>([]);
  const [status, setStatus] = useState<IndexStatus>({
    ready: false,
    building: false,
    count: 0,
    scanned: 0,
  });
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [scope, setScope] = useState("");  const [results, setResults] = useState<FileEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry | null } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<FileEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");

  /* 根目录 + 首次打开时自动建索引 */
  useEffect(() => {
    let alive = true;
    fsRoots()
      .then((list) => alive && setRoots(list))
      .catch(() => {});
    fsIndexStatus()
      .then((value) => {
        if (!alive) return;
        setStatus(value);
        if (!value.ready && !value.building) void fsIndexBuild();
      })
      .catch((err) => alive && message.error(errText(err)));
    return () => {
      alive = false;
    };
  }, [message]);

  /* 索引构建中轮询进度 */
  useEffect(() => {
    if (status.ready && !status.building) return;
    const timer = window.setInterval(() => {
      fsIndexStatus()
        .then(setStatus)
        .catch(() => {});
    }, 600);
    return () => window.clearInterval(timer);
  }, [status.ready, status.building]);

  /* 搜索：只查内存索引，输入即出结果 */
  useEffect(() => {
    const needle = deferredQuery.trim();
    if (!needle || !status.ready) {
      setResults([]);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      fsSearch(needle, scope || undefined, 300)
        .then((list) => alive && setResults(list))
        .catch((err) => {
          if (!alive) return;
          setResults([]);
          message.error(errText(err));
        })
        .finally(() => alive && setSearching(false));
    }, 160);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [deferredQuery, scope, status.ready, reloadKey, message]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  const rebuild = () => {
    setResults([]);
    setReloadKey((value) => value + 1);
    setStatus({ ready: false, building: true, count: 0, scanned: 0 });
    void fsIndexBuild().catch((err) => message.error(errText(err)));
  };

  const openEntry = async (entry: FileEntry) => {
    try {
      await fsOpenPath(entry.path);
    } catch (err) {
      message.error(errText(err));
    }
  };

  const reveal = async (entry: FileEntry) => {
    try {
      await fsRevealPath(entry.path);
    } catch (err) {
      message.error(errText(err));
    }
  };

  const openLocation = async (entry: FileEntry) => {
    try {
      await fsOpenPath(parentOf(entry.path));
    } catch (err) {
      message.error(errText(err));
    }
  };

  const copyPath = (path: string) => {
    void copyText(path).then(
      () => message.success(t("files.copied")),
      () => message.error(t("common.copyFailed")),
    );
  };

  const copyEntry = async (entry: FileEntry) => {
    try {
      await fsCopyToClipboard([entry.path]);
      message.success(t("files.copiedFiles"));
    } catch (err) {
      message.error(errText(err));
    }
  };

  const askDelete = (entry: FileEntry) => {
    modal.confirm({
      title: t("files.deleteConfirmTitle"),
      icon: null,
      content: t("files.deleteConfirm", { name: entry.name }),
      okText: t("common.delete"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await fsDelete([entry.path]);
          message.success(t("files.deleted"));
          setReloadKey((value) => value + 1);
        } catch (err) {
          message.error(errText(err));
        }
      },
    });
  };

  const submitRename = async () => {
    if (!renaming) return;
    try {
      await fsRename(renaming.path, renameValue);
      setRenaming(null);
      message.success(t("files.renamed"));
      setReloadKey((value) => value + 1);
    } catch (err) {
      message.error(errText(err));
    }
  };

  const openEntryMenu = (event: MouseEvent, entry: FileEntry) => {
    setSelected(entry.path);
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 280),
      entry,
    });
  };

  const needle = deferredQuery.trim();
  const needleLower = needle.toLowerCase();
  const indexing = !status.ready;

  return (
    <div
      className="module files-module"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({
          x: Math.min(event.clientX, window.innerWidth - 220),
          y: Math.min(event.clientY, window.innerHeight - 160),
          entry: null,
        });
      }}
    >
      <header className="module-head">
        <span className="module-icon">
          <FilesNavIcon />
        </span>
        <div>
          <Typography.Text strong style={{ fontSize: 14 }}>
            {t("module.files")}
          </Typography.Text>
          <div className="module-desc">{t("module.filesDesc")}</div>
        </div>
        <span style={{ flex: 1 }} />
        <span className="files-index-status">
          {status.building || indexing
            ? t("files.indexing", { count: status.scanned })
            : t("files.indexed", { count: status.count })}
        </span>
        <Tooltip title={t("files.rebuild")}>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={status.building}
            onClick={rebuild}
          />
        </Tooltip>
      </header>

      <div className="files-searchbar">
        <Input
          size="large"
          allowClear
          autoFocus
          className="files-search-input"
          prefix={<SearchOutlined />}
          placeholder={t("files.searchPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) void openEntry(results[0]);
          }}
        />
      </div>

      <div className="files-scopes">
        <button
          type="button"
          className={`files-scope${scope === "" ? " active" : ""}`}
          onClick={() => setScope("")}
        >
          {t("files.scopeAll")}
        </button>
        {roots.map((root) => (
          <button
            key={root.key}
            type="button"
            className={`files-scope${scope === root.path ? " active" : ""}`}
            onClick={() => setScope(root.path)}
          >
            <span className="files-scope-icon">{rootIcon(root.key)}</span>
            {t(`files.root.${root.key}`)}
          </button>
        ))}
      </div>

      <div className="files-results">
        {indexing ? (
          <div className="files-indexing">
            <div className="files-indexing-title">{t("files.indexingTitle")}</div>
            <div className="files-indexing-hint">
              {t("files.indexingHint", { count: status.scanned })}
            </div>
          </div>
        ) : !needle ? (
          <div className="files-empty">{t("files.prompt")}</div>
        ) : results.length === 0 && !searching ? (
          <div className="files-empty">{t("files.noResults")}</div>
        ) : (
          <>
            <div className="files-result-head">
              <span>
                {t("files.results", { count: results.length })}
                {searching ? ` · ${t("files.searching")}` : ""}
              </span>
            </div>
            {results.map((entry) => (
              <div
                key={entry.path}
                className={`files-row${selected === entry.path ? " selected" : ""}`}
                draggable={false}
                onDragStart={(event) => event.preventDefault()}
                onMouseDown={() => setSelected(entry.path)}
                onDoubleClick={() => void openEntry(entry)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openEntryMenu(event, entry);
                }}
              >
                <span className={`files-icon${entry.isDir ? " is-dir" : ""}`}>
                  {fileIcon(entry)}
                </span>
                <span className="files-name">
                  <Highlight text={entry.name} needle={needleLower} />
                </span>
                <span className="files-path-cell" title={entry.path}>
                  <Highlight text={parentOf(entry.path)} needle={needleLower} />
                </span>
                <span className="files-meta">
                  {entry.isDir ? "" : formatBytes(entry.size)}
                </span>
                <span className="files-time">
                  {entry.modified
                    ? dayjs(entry.modified * 1000).format("MM-DD HH:mm")
                    : ""}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      {menu && (
        <FilesContextMenu
          x={menu.x}
          y={menu.y}
          entry={menu.entry}
          onOpen={() => {
            if (menu.entry) void openEntry(menu.entry);
            setMenu(null);
          }}
          onReveal={() => {
            if (menu.entry) void reveal(menu.entry);
            setMenu(null);
          }}
          onOpenLocation={() => {
            if (menu.entry) void openLocation(menu.entry);
            setMenu(null);
          }}
          onCopyFiles={() => {
            if (menu.entry) void copyEntry(menu.entry);
            setMenu(null);
          }}
          onCopyPath={() => {
            copyPath(menu.entry ? menu.entry.path : scope);
            setMenu(null);
          }}
          onRename={() => {
            if (!menu.entry) return;
            setRenameValue(menu.entry.name);
            setRenaming(menu.entry);
            setMenu(null);
          }}
          onDelete={() => {
            if (menu.entry) askDelete(menu.entry);
            setMenu(null);
          }}
          onRefresh={() => {
            setReloadKey((value) => value + 1);
            setMenu(null);
          }}
        />
      )}

      <Modal
        open={renaming !== null}
        title={t("files.renameTitle")}
        okText={t("common.ok")}
        cancelText={t("common.cancel")}
        onOk={() => void submitRename()}
        onCancel={() => setRenaming(null)}
        destroyOnHidden
      >
        <Input
          autoFocus
          value={renameValue}
          placeholder={t("files.renamePlaceholder")}
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={() => void submitRename()}
        />
      </Modal>
    </div>
  );
}
