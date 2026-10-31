import { useCallback, useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { App as AntdApp, Button, Input, Modal, Tooltip, Typography } from "antd";
import { ArrowLeftOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import dayjs from "dayjs";
import { fsDelete, fsList, fsRename, fsRoots, fsSearch } from "../../api";
import { copyText } from "../../clipboard";
import { useT } from "../../i18n";
import { useUiStore } from "../../stores/uiStore";
import type { FileEntry, FileRoot } from "../../types";
import { errText, formatBytes } from "../../utils";
import { FilesNavIcon } from "../../components/NavIcons";
import FilesContextMenu from "./FilesContextMenu";
import { fileIcon, rootIcon } from "./fileIcons";

function parentOf(path: string): string {
  return path.replace(/[\\/][^\\/]+$/, "");
}

/** Everything 风格的文件搜索 / 浏览：只访问个人目录，不碰系统敏感目录 */
export default function FilesModule() {
  const t = useT(useUiStore((state) => state.lang));
  const { message, modal } = AntdApp.useApp();

  const [roots, setRoots] = useState<FileRoot[]>([]);
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry | null } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<FileEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");

  /* 根目录 */
  useEffect(() => {
    let alive = true;
    fsRoots()
      .then((list) => {
        if (!alive) return;
        setRoots(list);
        if (list[0]) setDir(list[0].path);
      })
      .catch((err) => alive && setError(errText(err)));
    return () => {
      alive = false;
    };
  }, []);

  /* 当前目录 */
  useEffect(() => {
    if (!dir) return;
    let alive = true;
    setLoading(true);
    setError(null);
    fsList(dir)
      .then((list) => alive && setEntries(list))
      .catch((err) => {
        if (!alive) return;
        setEntries([]);
        setError(errText(err));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [dir, reloadKey]);

  /* 搜索（输入防抖） */
  useEffect(() => {
    const needle = query.trim();
    if (!needle) {
      setResults(null);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      fsSearch(needle, 300)
        .then((list) => alive && setResults(list))
        .catch((err) => {
          if (!alive) return;
          setResults([]);
          setError(errText(err));
        })
        .finally(() => alive && setSearching(false));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  const refresh = useCallback(() => {
    const needle = query.trim();
    if (needle) {
      setSearching(true);
      fsSearch(needle, 300)
        .then(setResults)
        .catch((err) => {
          setResults([]);
          setError(errText(err));
        })
        .finally(() => setSearching(false));
    } else {
      setReloadKey((value) => value + 1);
    }
  }, [query]);

  const navigate = (path: string) => {
    setDir(path);
    setQuery("");
    setResults(null);
    setSelected(null);
  };

  const openEntry = async (entry: FileEntry) => {
    if (entry.isDir) {
      navigate(entry.path);
      return;
    }
    try {
      await openPath(entry.path);
    } catch (err) {
      message.error(errText(err));
    }
  };

  const reveal = async (entry: FileEntry) => {
    try {
      await revealItemInDir(entry.path);
    } catch (err) {
      message.error(errText(err));
    }
  };

  const openLocation = async (entry: FileEntry) => {
    try {
      await openPath(parentOf(entry.path));
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
          refresh();
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
      refresh();
    } catch (err) {
      message.error(errText(err));
    }
  };

  const openEntryMenu = (event: MouseEvent, entry: FileEntry) => {
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 280),
      entry,
    });
  };

  const showEntries = results ?? entries;
  const busy = results === null ? loading : searching;
  const atRoot = roots.some((root) => root.path === dir);

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
        <Input
          className="files-search"
          size="small"
          allowClear
          prefix={<SearchOutlined />}
          placeholder={t("files.searchPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Tooltip title={t("files.refresh")}>
          <Button size="small" icon={<ReloadOutlined />} onClick={refresh} />
        </Tooltip>
      </header>

      <div className="files-body">
        <aside className="files-roots">
          {roots.map((root) => (
            <button
              key={root.key}
              type="button"
              className={`files-root${dir === root.path && results === null ? " active" : ""}`}
              onClick={() => navigate(root.path)}
            >
              <span className="files-root-icon">{rootIcon(root.key)}</span>
              <span>{t(`files.root.${root.key}`)}</span>
            </button>
          ))}
        </aside>

        <section className="files-main">
          <div className="files-toolbar">
            <Button
              size="small"
              type="text"
              icon={<ArrowLeftOutlined />}
              disabled={atRoot || !dir}
              onClick={() => navigate(parentOf(dir))}
            />
            <span className="files-path" title={dir}>
              {dir}
            </span>
            <span style={{ flex: 1 }} />
            {results !== null && (
              <span className="files-count">{t("files.results", { count: results.length })}</span>
            )}
            {busy && <span className="files-count">{t("files.loading")}</span>}
          </div>

          <div className="files-list">
            {error && <div className="files-error">{error}</div>}
            {!error && showEntries.length === 0 && !busy && (
              <div className="files-empty">
                {query.trim() ? t("files.noResults") : t("files.empty")}
              </div>
            )}
            {showEntries.map((entry) => (
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
                  setSelected(entry.path);
                  openEntryMenu(event, entry);
                }}
              >
                <span className={`files-icon${entry.isDir ? " is-dir" : ""}`}>
                  {fileIcon(entry)}
                </span>
                <span className="files-name">{entry.name}</span>
                <span className="files-meta">
                  {results !== null
                    ? parentOf(entry.path)
                    : entry.isDir
                      ? ""
                      : formatBytes(entry.size)}
                </span>
                {results === null && !entry.isDir && (
                  <span className="files-time">
                    {entry.modified
                      ? dayjs(entry.modified * 1000).format("MM-DD HH:mm")
                      : ""}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
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
          onCopyPath={() => {
            copyPath(menu.entry ? menu.entry.path : dir);
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
            refresh();
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
