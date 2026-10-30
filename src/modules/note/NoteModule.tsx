import { useEffect, useMemo, useRef, useState } from "react";
import { App as AntdApp, Button, Input, Segmented, Typography } from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  FileAddOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import { saveText } from "../../save";
import { NoteNavIcon } from "../../components/NavIcons";
import { renderMarkdown } from "./markdown";
import {
  createNote,
  loadNotes,
  saveNotes,
  type Note,
  type NoteFormat,
} from "./store";

function formatTime(timestamp: number): string {
  return dayjs(timestamp).format("MM-DD HH:mm");
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "note";
}

const SIDE_WIDTH_KEY = "note.sideWidth";
const DEFAULT_SIDE_WIDTH = 232;
const MIN_SIDE_WIDTH = 180;
const MAX_SIDE_WIDTH = 560;

function loadSideWidth(): number {
  try {
    const raw = localStorage.getItem(SIDE_WIDTH_KEY);
    const value = raw === null ? Number.NaN : Number(raw);
    if (Number.isFinite(value) && value >= MIN_SIDE_WIDTH) {
      return Math.min(MAX_SIDE_WIDTH, value);
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SIDE_WIDTH;
}

export default function NoteModule() {
  const t = useT(useUiStore((state) => state.lang));
  const { message, modal } = AntdApp.useApp();
  const [notes, setNotes] = useState<Note[]>(loadNotes);
  const [activeId, setActiveId] = useState<string | null>(
    () => loadNotes()[0]?.id ?? null,
  );
  const [preview, setPreview] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const [menu, setMenu] = useState<{ x: number; y: number; noteId: string } | null>(
    null,
  );
  const [sideWidth, setSideWidth] = useState(loadSideWidth);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const ordered = useMemo(
    () => [...notes].sort((a, b) => b.updatedAt - a.updatedAt),
    [notes],
  );
  const active = notes.find((note) => note.id === activeId) ?? null;
  const menuNote = menu
    ? notes.find((note) => note.id === menu.noteId) ?? null
    : null;

  useEffect(() => {
    try {
      localStorage.setItem(SIDE_WIDTH_KEY, String(Math.round(sideWidth)));
    } catch {
      /* ignore */
    }
  }, [sideWidth]);

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
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      saveNotes(notes);
      setSaveState("saved");
    }, 300);
    return () => window.clearTimeout(timer);
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
    const extension = note.format === "md" ? "md" : "txt";
    const fileName = `${safeFileName(note.title.trim() || t("note.untitled"))}.${extension}`;
    try {
      await saveText(
        fileName,
        note.content,
        [
          {
            name: note.format === "md" ? "Markdown" : t("note.formatTxt"),
            extensions: [extension],
          },
        ],
        note.format === "md" ? "text/markdown" : "text/plain",
      );
    } catch (error) {
      message.error(errText(error));
    }
  };

  return (
    <div className="module note-module">
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
          {saveState === "saving" ? t("note.saving") : t("note.saved")}
        </span>
        <Button icon={<FileAddOutlined />} onClick={addNote}>
          {t("note.new")}
        </Button>
      </header>

      <div className="note-body" ref={bodyRef}>
        <aside className="note-side" style={{ width: sideWidth }}>
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
                  setPreview(false);
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
                    {note.format === "md" ? "MD" : "TXT"}
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
                <span style={{ flex: 1 }} />
              </div>

              {active.format === "md" && preview ? (
                <div className="note-preview note-md">
                  {renderMarkdown(active.content)}
                </div>
              ) : (
                <textarea
                  className="note-editor"
                  value={active.content}
                  placeholder={t("note.contentPlaceholder")}
                  spellCheck={false}
                  onChange={(event) =>
                    patch(active.id, { content: event.target.value })
                  }
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
              <span className="note-empty-icon">
                <NoteNavIcon />
              </span>
              <div className="note-empty-title">{t("note.noSelection")}</div>
              <div className="note-hint">{t("note.noSelectionHint")}</div>
              <Button type="primary" icon={<FileAddOutlined />} onClick={addNote}>
                {t("note.new")}
              </Button>
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
