import { useDeferredValue, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { App as AntdApp, Button, Input, Modal, Tooltip, Typography } from "antd";
import {
  FileSearchOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
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
import { errText, formatBytes, isImeEnter } from "../../utils";
import { FilesNavIcon } from "../../components/NavIcons";
import FilesContextMenu from "./FilesContextMenu";
import { fileIcon, rootIcon } from "./fileIcons";

function parentOf(path: string): string {
  return path.replace(/[\\/][^\\/]+$/, "");
}

function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  if (tokens.length === 0) return <>{text}</>;
  const pattern = new RegExp(
    `(${tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return (
    <>
      {text.split(pattern).map((piece, index) =>
        tokens.some((token) => piece.toLowerCase() === token.toLowerCase()) ? (
          <mark key={index} className="files-hit">
            {piece}
          </mark>
        ) : (
          piece
        ),
      )}
    </>
  );
}

/** 文件夹 / 扩展名 / 可执行文件 / 普通文件 */
function typeLabel(
  entry: FileEntry,
  folderLabel: string,
  fileLabel: string,
  executableLabel: string,
): string {
  if (entry.isDir) return folderLabel;
  const dot = entry.name.lastIndexOf(".");
  if (dot <= 0 || dot === entry.name.length - 1) {
    return entry.executable ? executableLabel : fileLabel;
  }
  return entry.name.slice(dot + 1).toLowerCase();
}

function IndexingArt() {
  return (
    <svg
      className="files-art files-art-spin"
      viewBox="0 0 64 64"
      width={40}
      height={40}
      style={{ width: 40, height: 40, flex: "none" }}
      aria-hidden="true"
    >
      <circle cx="32" cy="32" r="24" fill="none" stroke="var(--border-strong)" strokeWidth="4" />
      <circle
        cx="32"
        cy="32"
        r="24"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="34 116"
      />
    </svg>
  );
}

/** Everything 风格：后台建立文件索引，输入文件名直接查内存索引 */
const IS_MAC = /mac/i.test(navigator.userAgent);

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
  const [scope, setScope] = useState("");
  const [results, setResults] = useState<FileEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement | null>(null);
  const moduleRef = useRef<HTMLDivElement | null>(null);
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
    }, 150);
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

  /* 结果刷新后清空键盘选中 */
  useEffect(() => {
    setActiveIndex(-1);
  }, [results]);

  /* 键盘上下移动时保证当前行可见 */
  useEffect(() => {
    if (activeIndex < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(".files-row.active")
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

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

  /* 焦点不在搜索框时，上下键 / 回车仍然操作结果列表 */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") {
        return;
      }
      // 模块被切走（display:none）时不要拦截全局按键
      const container = moduleRef.current;
      if (!container || container.getClientRects().length === 0) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        const typing =
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable;
        // 输入框自己处理方向键；回车不要抢按钮的默认行为
        if (typing) return;
        if (event.key === "Enter" && (tag === "BUTTON" || tag === "A")) return;
      }
      if (menu || renaming || results.length === 0) return;

      event.preventDefault();
      if (event.key === "Enter") {
        const entry = results[activeIndex] ?? results[0];
        if (entry) void openEntry(entry);
        return;
      }
      setActiveIndex((index) => {
        if (event.key === "ArrowDown") {
          return index < 0 ? 0 : Math.min(index + 1, results.length - 1);
        }
        return index < 0 ? results.length - 1 : Math.max(index - 1, 0);
      });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [results, activeIndex, menu, renaming, openEntry]);

  const reveal = async (entry: FileEntry) => {
    try {
      await fsRevealPath(entry.path);
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
      content: t(IS_MAC ? "files.deleteConfirmTrash" : "files.deleteConfirmRecycle", {
        name: entry.name,
      }),
      okText: t("common.delete"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await fsDelete([entry.path]);
          message.success(t(IS_MAC ? "files.deletedTrash" : "files.deletedRecycle"));
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
      // 从鼠标位置开始向右下展开
      x: event.clientX,
      y: event.clientY,
      entry,
    });
  };

  const needle = deferredQuery.trim();
  const tokens = needle
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((token) => {
      // 路径查询：折叠重复分隔符，并同时给出 / 与 \ 两种写法用于高亮
      const collapsed = token.toLowerCase().replace(/[\\/]+/g, "/");
      return [collapsed, collapsed.replace(/\//g, "\\")];
    });
  const indexing = !status.ready;
  // 没有可展示的列表时（索引中 / 未搜索 / 无结果）让占位内容整体居中
  const placeholder = indexing || !needle || (results.length === 0 && !searching);

  return (
    <div
      className="module files-module"
      ref={moduleRef}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({
          x: event.clientX,
          y: event.clientY,
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
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              // 上下键在输入框里只用来选结果，不移动光标
              event.preventDefault();
              if (results.length === 0) return;
              setActiveIndex((index) => {
                if (event.key === "ArrowDown") {
                  return index < 0 ? 0 : Math.min(index + 1, results.length - 1);
                }
                return index < 0 ? results.length - 1 : Math.max(index - 1, 0);
              });
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              const entry = results[activeIndex] ?? results[0];
              if (entry) void openEntry(entry);
            }
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

      <div
        className={`files-results${placeholder ? " is-placeholder" : ""}`}
        ref={listRef}
      >
        {indexing ? (
          <div className="files-indexing files-empty">
            <span className="files-empty-glyph is-spinning">
              <IndexingArt />
            </span>
            <div className="files-empty-title">{t("files.indexingTitle")}</div>
            <div className="files-empty-hint">
              {t("files.indexingHint", { count: status.scanned })}
            </div>
          </div>
        ) : !needle ? (
          <div className="files-empty">
            <span className="files-empty-glyph">
              <FileSearchOutlined />
            </span>
            <div className="files-empty-title">{t("files.emptyTitle")}</div>
            <div className="files-empty-hint">{t("files.prompt")}</div>
          </div>
        ) : results.length === 0 && !searching ? (
          <div className="files-empty">
            <span className="files-empty-glyph">
              <FileSearchOutlined />
            </span>
            <div className="files-empty-title">{t("files.noResults")}</div>
            <div className="files-empty-hint">{t("files.prompt")}</div>
          </div>
        ) : (
          <>
            <div className="files-result-head">
              <span>
                {t("files.results", { count: results.length })}
                {searching ? ` · ${t("files.searching")}` : ""}
              </span>
            </div>
            <div className="files-columns">
              <span />
              <span className="files-col-name">{t("files.colName")}</span>
              <span className="files-col-path">{t("files.colPath")}</span>
              <span className="files-col-type">{t("files.colType")}</span>
              <span className="files-col-size">{t("files.colSize")}</span>
              <span className="files-col-time">{t("files.colTime")}</span>
            </div>
            {results.map((entry, index) => (
              <div
                key={entry.path}
                className={`files-row${selected === entry.path ? " selected" : ""}${
                  activeIndex === index ? " active" : ""
                }`}
                draggable={false}
                onDragStart={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={() => {
                  setSelected(entry.path);
                  setActiveIndex(index);
                }}
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
                  <Highlight text={entry.name} tokens={tokens} />
                </span>
                <span className="files-path-cell" title={entry.path}>
                  <Highlight text={parentOf(entry.path)} tokens={tokens} />
                </span>
                <span className="files-type">
                  {typeLabel(
                    entry,
                    t("files.typeFolder"),
                    t("files.typeFile"),
                    t("files.typeExecutable"),
                  )}
                </span>
                <span className="files-meta">
                  {entry.isDir ? "" : formatBytes(entry.size)}
                </span>
                <span className="files-time">
                  {entry.modified
                    ? dayjs(entry.modified * 1000).format("YYYY-MM-DD HH:mm")
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
          onPressEnter={(event) => {
            if (isImeEnter(event)) return;
            void submitRename();
          }}
        />
      </Modal>
    </div>
  );
}
