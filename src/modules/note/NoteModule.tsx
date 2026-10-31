import { useEffect, useMemo, useRef, useState } from "react";
import { App as AntdApp, Button, Input, Segmented, Select, Tooltip, Typography } from "antd";
import {
  CheckOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  LoadingOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import { saveText } from "../../save";
import { NoteNavIcon } from "../../components/NavIcons";
import { renderMarkdown } from "./markdown";
import {
  formatJsonInput,
  highlightJsonText,
  isWhitespaceOnlyChange,
  mapCaret,
} from "../text/jsonHighlight";
import {
  NOTE_FONT_STACKS,
  NOTE_FONT_SIZES,
  type NoteFont,
} from "./fonts";
import {
  createNote,
  loadNotes,
  saveNotes,
  type Note,
  type NoteFormat,
} from "./store";

function formatTime(timestamp: number): string {
  return dayjs(timestamp).format("YYYY-MM-DD HH:mm");
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "note";
}

const MIN_SIDE_WIDTH = 200;
const MAX_SIDE_WIDTH = 560;

export default function NoteModule() {
  const t = useT(useUiStore((state) => state.lang));
  const { message, modal } = AntdApp.useApp();
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoaded, setNotesLoaded] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const caretRef = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    let alive = true;
    void loadNotes().then((list) => {
      if (!alive) return;
      setNotes(list);
      setActiveId(list[0]?.id ?? null);
      setNotesLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  const [menu, setMenu] = useState<{ x: number; y: number; noteId: string } | null>(
    null,
  );
  const sideWidth = useUiStore((state) => state.sideWidth);
  const setSideWidth = useUiStore((state) => state.setSideWidth);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** 已自动切过预览的笔记，避免编辑时反复强制切换 */
  const autoPreviewRef = useRef<string | null>(null);

  const ordered = useMemo(
    () => [...notes].sort((a, b) => b.updatedAt - a.updatedAt),
    [notes],
  );
  const active = notes.find((note) => note.id === activeId) ?? null;

  /* 自动格式化后恢复光标，避免跳到末尾 */
  useEffect(() => {
    const caret = caretRef.current;
    if (!caret) return;
    caretRef.current = null;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.setSelectionRange(caret.start, caret.end);
  }, [active?.content]);

  const menuNote = menu
    ? notes.find((note) => note.id === menu.noteId) ?? null
    : null;

  /* 打开内容较多的 Markdown 笔记时，直接进入预览 */
  useEffect(() => {
    if (!activeId || autoPreviewRef.current === activeId) return;
    autoPreviewRef.current = activeId;
    const note = notes.find((item) => item.id === activeId);
    if (!note || note.format !== "md") return;
    const lines = note.content.split("\n").length;
    if (lines > 30 || note.content.length > 1200) {
      setPreview(true);
    }
  }, [activeId, notes]);

  /** 拖动左右分栏之间的分隔条调整左侧宽度 */
  const startSideResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sideWidth;
    const containerWidth = bodyRef.current?.clientWidth ?? 960;
    const maxWidth = Math.max(
      MIN_SIDE_WIDTH,
      Math.min(MAX_SIDE_WIDTH, containerWidth - 360),
    );
    document.body.classList.add("note-resizing");
    const onMove = (moveEvent: MouseEvent) => {
      const next = startWidth + (moveEvent.clientX - startX);
      setSideWidth(Math.min(maxWidth, Math.max(MIN_SIDE_WIDTH, next)));
    };
    const onUp = () => {
      document.body.classList.remove("note-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  useEffect(() => {
    if (!notesLoaded) return;
    const startedAt = Date.now();
    setSaveState("saving");
    let finish: number | undefined;
    const timer = window.setTimeout(() => {
      void saveNotes(notes);
      // loading 至少播放 100ms，避免保存太快时闪一下
      const wait = Math.max(0, 100 - (Date.now() - startedAt));
      finish = window.setTimeout(() => setSaveState("saved"), wait);
    }, 300);
    return () => {
      window.clearTimeout(timer);
      if (finish !== undefined) window.clearTimeout(finish);
    };
  }, [notes]);

  const patch = (id: string, next: Partial<Note>) => {
    setNotes((prev) =>
      prev.map((note) =>
        note.id === id ? { ...note, ...next, updatedAt: Date.now() } : note,
      ),
    );
  };

  const addNote = () => {
    const note = createNote("md");
    setNotes((prev) => [note, ...prev]);
    setActiveId(note.id);
    setPreview(false);
  };

  const removeNote = (note: Note) => {
    modal.confirm({
      title: t("note.deleteNote"),
      icon: null,
      content: t("note.deleteConfirm", {
        name: note.title.trim() || t("note.untitled"),
      }),
      okText: t("common.delete"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: () => {
        const rest = notes.filter((item) => item.id !== note.id);
        setNotes(rest);
        if (activeId === note.id) {
          setActiveId(rest[0]?.id ?? null);
          setPreview(false);
        }
      },
    });
  };

  const exportNote = async (note: Note) => {
    const extension =
      note.format === "md" ? "md" : note.format === "json" ? "json" : "txt";
    const fileName = `${safeFileName(note.title.trim() || t("note.untitled"))}.${extension}`;
    try {
      await saveText(
        fileName,
        note.content,
        [
          {
            name:
              note.format === "md"
                ? "Markdown"
                : note.format === "json"
                  ? "JSON"
                  : t("note.formatTxt"),
            extensions: [extension],
          },
        ],
        note.format === "md"
          ? "text/markdown"
          : note.format === "json"
            ? "application/json"
            : "text/plain",
      );
    } catch (error) {
      message.error(errText(error));
    }
  };

  const editorStyle = {
    fontFamily: NOTE_FONT_STACKS[active?.font ?? "mono"],
    fontSize:
      active?.format === "txt" ? `${active.fontSize ?? 13}px` : undefined,
  };

  const handleEditorChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    if (!active) return;
    const raw = event.target.value;
    if (active.format !== "json") {
      patch(active.id, { content: raw });
      return;
    }
    // 只是敲了回车 / 空格 / Tab：原样保留，绝不格式化
    if (isWhitespaceOnlyChange(active.content, raw)) {
      patch(active.id, { content: raw });
      return;
    }
    // 解析成功就自动缩进；解析失败保持原样（不提示）
    const formatted = formatJsonInput(raw);
    if (formatted !== null && formatted !== raw) {
      const editor = event.currentTarget;
      caretRef.current = {
        start: mapCaret(raw, editor.selectionStart, formatted),
        end: mapCaret(raw, editor.selectionEnd, formatted),
      };
      patch(active.id, { content: formatted });
      return;
    }
    patch(active.id, { content: raw });
  };

  return (
    <div className={`module note-module${fullscreen ? " is-fullscreen" : ""}`}>
      <header className="module-head">
        <span className="module-icon">
          <NoteNavIcon />
        </span>
        <div>
          <Typography.Text strong style={{ fontSize: 14 }}>
            {t("module.note")}
          </Typography.Text>
          <div className="module-desc">{t("module.noteDesc")}</div>
        </div>
        <span style={{ flex: 1 }} />
        <span className="note-save-state">
          {saveState === "saving" ? (
            <>
              <LoadingOutlined spin /> {t("note.saving")}
            </>
          ) : (
            <>
              <CheckOutlined /> {t("note.saved")}
            </>
          )}
        </span>
      </header>

      <div className="note-body" ref={bodyRef}>
        <aside className="note-side" style={{ width: sideWidth }}>
          <Button block icon={<PlusOutlined />} onClick={addNote}>
            {t("note.new")}
          </Button>
          <div className="note-list">
            {ordered.length === 0 && (
              <div className="note-list-empty">{t("note.emptyList")}</div>
            )}
            {ordered.map((note) => (
              <div
                key={note.id}
                className={`note-item${note.id === activeId ? " active" : ""}`}
                role="button"
                tabIndex={0}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setActiveId(note.id);
                  setMenu({
                    x: Math.min(event.clientX, window.innerWidth - 180),
                    y: Math.min(event.clientY, window.innerHeight - 100),
                    noteId: note.id,
                  });
                }}
                onClick={() => {
                  setActiveId(note.id);
                  setPreview(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveId(note.id);
                    setPreview(false);
                  }
                }}
              >
                <div className="note-item-title">
                  {note.title.trim() || t("note.untitled")}
                </div>
                <div className="note-item-meta">
                  <span className={`note-format note-format-${note.format}`}>
                    {note.format === "md"
                      ? "MD"
                      : note.format === "json"
                        ? "JSON"
                        : "TXT"}
                  </span>
                  <span>{formatTime(note.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="note-side-resizer" onMouseDown={startSideResize} />

        <section className="note-main">
          {active ? (
            <>
              <div className="note-toolbar">
                <Input
                  className="note-title-input"
                  value={active.title}
                  placeholder={t("note.titlePlaceholder")}
                  onChange={(event) => patch(active.id, { title: event.target.value })}
                />
                <Segmented
                  size="small"
                  value={active.format}
                  onChange={(value) =>
                    patch(active.id, { format: value as NoteFormat })
                  }
                  options={[
                    { value: "md", label: t("note.formatMd") },
                    { value: "txt", label: t("note.formatTxt") },
                    { value: "json", label: "JSON" },
                  ]}
                />
                {active.format === "md" && (
                  <Segmented
                    size="small"
                    value={preview ? "preview" : "edit"}
                    onChange={(value) => setPreview(value === "preview")}
                    options={[
                      { value: "edit", label: t("note.edit") },
                      { value: "preview", label: t("note.preview") },
                    ]}
                  />
                )}
                {active.format !== "json" && (
                <Select
                  size="small"
                  className="note-font-select"
                  value={active.font ?? "mono"}
                  title={t("note.font")}
                  onChange={(value) =>
                    patch(active.id, { font: value as NoteFont })
                  }
                  options={[
                    { value: "system", label: t("note.fontSystem") },
                    { value: "sans", label: t("note.fontSans") },
                    { value: "serif", label: t("note.fontSerif") },
                    { value: "mono", label: t("note.fontMono") },
                    { value: "kai", label: t("note.fontKai") },
                  ]}
                />
                )}
                {active.format === "txt" && (
                  <Select
                    size="small"
                    className="note-font-select note-size-select"
                    value={active.fontSize ?? 13}
                    title={t("note.fontSize")}
                    onChange={(value) =>
                      patch(active.id, { fontSize: Number(value) })
                    }
                    options={NOTE_FONT_SIZES.map((size) => ({
                      value: size,
                      label: `${size}px`,
                    }))}
                  />
                )}
                <span style={{ flex: 1 }} />
                <Tooltip
                  title={
                    fullscreen ? t("note.exitFullscreen") : t("note.fullscreen")
                  }
                >
                  <Button
                    size="small"
                    type="text"
                    icon={
                      fullscreen ? (
                        <FullscreenExitOutlined />
                      ) : (
                        <FullscreenOutlined />
                      )
                    }
                    onClick={() => setFullscreen((value) => !value)}
                  />
                </Tooltip>
              </div>

              {active.format === "md" && preview ? (
                <div
                  className="note-preview note-md"
                  style={{ fontFamily: NOTE_FONT_STACKS[active.font ?? "mono"] }}
                >
                  {renderMarkdown(active.content)}
                </div>
              ) : active.format === "json" ? (
                <div className="note-json-editor">
                    <pre
                      className="note-json-highlight"
                      aria-hidden="true"
                      style={editorStyle}
                    >
                      {highlightJsonText(active.content)}
                      {"\n"}
                    </pre>
                    <textarea
                      ref={editorRef}
                      className="note-editor note-json-input"
                      style={editorStyle}
                      value={active.content}
                      placeholder={t("note.contentPlaceholder")}
                      spellCheck={false}
                      onChange={handleEditorChange}
                      onPaste={() => {
                        // 粘贴时无条件格式化一次（多行也整理）
                        window.setTimeout(() => {
                          const editor = editorRef.current;
                          if (!editor || !active) return;
                          const formatted = formatJsonInput(editor.value);
                          if (formatted !== null && formatted !== editor.value) {
                            caretRef.current = {
                              start: mapCaret(editor.value, editor.selectionStart, formatted),
                              end: mapCaret(editor.value, editor.selectionEnd, formatted),
                            };
                            patch(active.id, { content: formatted });
                          }
                        }, 0);
                      }}
                      onScroll={(event) => {
                        const pre = event.currentTarget.previousElementSibling;
                        if (pre instanceof HTMLElement) {
                          pre.scrollTop = event.currentTarget.scrollTop;
                          pre.scrollLeft = event.currentTarget.scrollLeft;
                        }
                      }}
                  />
                </div>
              ) : (
                <textarea
                  ref={editorRef}
                  className="note-editor"
                  style={editorStyle}
                  value={active.content}
                  placeholder={t("note.contentPlaceholder")}
                  spellCheck={false}
                  onChange={handleEditorChange}
                />
              )}

              <div className="note-status">
                {t("note.chars", { count: active.content.length })}
                <span className="note-status-sep">·</span>
                {t("note.updatedAt", { time: formatTime(active.updatedAt) })}
              </div>
            </>
          ) : (
            <div className="note-empty">
              <span className="app-empty-glyph">
                <NoteNavIcon />
              </span>
              <div className="app-empty-title">{t("note.noSelection")}</div>
              <div className="app-empty-hint">{t("note.noSelectionHint")}</div>
            </div>
          )}
        </section>
      </div>

      {menu && menuNote && (
        <div
          className="note-context-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              void exportNote(menuNote);
            }}
          >
            <DownloadOutlined />
            {t("note.download")}
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              setMenu(null);
              removeNote(menuNote);
            }}
          >
            <DeleteOutlined />
            {t("note.deleteNote")}
          </button>
        </div>
      )}
    </div>
  );
}
