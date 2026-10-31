import { useMemo, useRef, useState } from "react";
import { App as AntdApp, Button, Segmented, Select } from "antd";
import {
  AlignLeftOutlined,
  ClearOutlined,
  CompressOutlined,
  CopyOutlined,
  ExpandAltOutlined,
  ShrinkOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { copyText } from "../../clipboard";
import { errText, formatBytes } from "../../utils";
import JsonTree, { collectContainerPaths, type JsonValue } from "./JsonTree";
import { highlightJsonText } from "./jsonHighlight";

const SAMPLE = JSON.stringify(
  {
    name: "yooso-toolbox",
    version: "0.1.0",
    enabled: true,
    modules: ["ssh", "api", "qrcode", "translate", "text"],
    owner: {
      name: "Yooso",
      site: "https://www.yoosobyte.com",
      since: 2024,
    },
    tags: null,
  },
  null,
  2,
);

interface JsonError {
  message: string;
  line?: number;
  column?: number;
}

function toError(error: unknown, source: string): JsonError {
  const raw = errText(error);
  const match = /position\s+(\d+)/i.exec(raw);
  const message = raw.replace(/\s+in JSON at position \d+.*$/i, "");
  if (!match) return { message };
  const position = Math.min(Number(match[1]), source.length);
  const before = source.slice(0, position).replace(/\r\n?/g, "\n");
  const lines = before.split("\n");
  return {
    message,
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

export default function JsonTool() {
  const t = useT(useUiStore((state) => state.lang));
  const { message } = AntdApp.useApp();

  const [input, setInput] = useState("");
  const [value, setValue] = useState<JsonValue | undefined>(undefined);
  const [error, setError] = useState<JsonError | null>(null);
  const [view, setView] = useState<"text" | "tree">("text");
  const [indent, setIndent] = useState("2");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [paths, setPaths] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const applyParsed = (parsed: JsonValue) => {
    setValue(parsed);
    setError(null);
    setPaths(collectContainerPaths(parsed).map((item) => item.path));
    // 解析成功默认全部展开
    setCollapsed(new Set());
  };

  /** 在当前编辑框里直接格式化 / 压缩；只有粘贴时才自动切到树形预览 */
  const transform = (source: string, kind: "format" | "minify", preview = false) => {
    const text = source.trim();
    if (!text) return;
    try {
      const parsed = JSON.parse(text) as JsonValue;
      const next =
        kind === "minify"
          ? JSON.stringify(parsed)
          : JSON.stringify(parsed, null, indent === "tab" ? "\t" : Number(indent));
      setInput(next);
      applyParsed(parsed);
      // 手动格式化 / 压缩保持文本视图；只有粘贴才自动进树形预览
      setView(preview ? "tree" : "text");
    } catch (err) {
      setInput(source);
      setValue(undefined);
      setError(toError(err, source));
      setPaths([]);
      setCollapsed(new Set());
      setView("text");
    }
  };

  const showTree = (next: boolean) => {
    if (!next) {
      setView("text");
      return;
    }
    const text = input.trim();
    if (!text) return;
    try {
      const parsed = JSON.parse(text) as JsonValue;
      applyParsed(parsed);
      setView("tree");
    } catch (err) {
      setError(toError(err, text));
      setValue(undefined);
      setPaths([]);
      setCollapsed(new Set());
      setView("text");
    }
  };

  const onPaste = () => {
    // 等浏览器把剪贴板内容真正插入后，再读一次 DOM 里的完整文本自动格式化
    window.setTimeout(() => {
      const element = inputRef.current;
      if (!element) return;
      const text = element.value;
      if (!text.trim()) return;
      // 粘贴是唯一会自动跳转到树形预览的入口
      transform(text, "format", true);
    }, 0);
  };

  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const copyOutput = () => {
    if (!input.trim()) return;
    void copyText(input).then(
      () => message.success(t("text.copied")),
      () => message.error(t("common.copyFailed")),
    );
  };

  const clear = () => {
    setInput("");
    setValue(undefined);
    setError(null);
    setPaths([]);
    setCollapsed(new Set());
    setView("text");
  };

  const stats = useMemo(() => {
    if (!input) return null;
    return t("text.stats", {
      lines: input.split("\n").length,
      size: formatBytes(new TextEncoder().encode(input).length),
    });
  }, [input, t]);

  const allExpanded = paths.length === 0 || collapsed.size === 0;

  return (
    <div className="txt-body">
      <section className="txt-panel">
        <div className="txt-panel-head">
          <span className="txt-panel-title">{t("text.tabJson")}</span>
          {stats && <span className="txt-meta">{stats}</span>}
          <span style={{ flex: 1 }} />
          <Segmented
            size="small"
            value={view}
            onChange={(next) => showTree(next === "tree")}
            options={[
              { value: "text", label: t("text.raw") },
              { value: "tree", label: t("text.tree") },
            ]}
          />
          {view === "tree" && paths.length > 0 && (
            <Button
              size="small"
              type="text"
              icon={allExpanded ? <ShrinkOutlined /> : <ExpandAltOutlined />}
              onClick={() => setCollapsed(allExpanded ? new Set(paths) : new Set())}
            >
              {allExpanded ? t("text.collapseAll") : t("text.expandAll")}
            </Button>
          )}
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={copyOutput}
            disabled={!input.trim()}
          >
            {t("common.copy")}
          </Button>
        </div>

        <div className={`txt-panel-body txt-json-body${view === "tree" ? " is-tree" : ""}`}>
          {view === "text" ? (
            <>
              {error && (
                <div className="txt-error txt-json-error">
                  <div className="txt-error-title">
                    <WarningOutlined /> {t("text.invalid")}
                  </div>
                  <div className="txt-error-msg">{error.message}</div>
                  {error.line !== undefined && error.column !== undefined && (
                    <div className="txt-error-pos">
                      {t("text.errorAt", { line: error.line, column: error.column })}
                    </div>
                  )}
                </div>
              )}
              <div className="txt-json-editor">
                <pre className="txt-json-highlight" aria-hidden="true">
                  {highlightJsonText(input)}
                  {"\n"}
                </pre>
                <textarea
                  ref={inputRef}
                  className="txt-textarea txt-json-input"
                  value={input}
                  spellCheck={false}
                  placeholder={t("text.jsonPlaceholder")}
                  onChange={(event) => setInput(event.target.value)}
                  onPaste={onPaste}
                  onScroll={(event) => {
                    const pre = event.currentTarget.previousElementSibling;
                    if (pre instanceof HTMLElement) {
                      pre.scrollTop = event.currentTarget.scrollTop;
                      pre.scrollLeft = event.currentTarget.scrollLeft;
                    }
                  }}
                />
              </div>
            </>
          ) : value !== undefined ? (
            <div className="txt-json-tree-wrap">
              <JsonTree
                value={value}
                collapsed={collapsed}
                onToggle={toggle}
                itemsLabel={t("text.items")}
                keysLabel={t("text.keys")}
              />
            </div>
          ) : (
            <div className="txt-empty">
              <span className="txt-empty-icon">{"{ }"}</span>
              <div>{t("text.emptyResult")}</div>
            </div>
          )}
        </div>

        <div className="txt-panel-foot">
          <span className="txt-hint">{t("text.indent")}</span>
          <Select
            size="small"
            value={indent}
            onChange={setIndent}
            className="txt-indent-select"
            options={[
              { value: "2", label: "2" },
              { value: "4", label: "4" },
              { value: "tab", label: "Tab" },
            ]}
          />
          <span style={{ flex: 1 }} />
          <Button size="small" type="text" onClick={() => transform(SAMPLE, "format")}>
            {t("text.sample")}
          </Button>
          <Button size="small" type="text" icon={<ClearOutlined />} onClick={clear}>
            {t("text.clear")}
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<AlignLeftOutlined />}
            disabled={!input.trim()}
            onClick={() => transform(input, "format")}
          >
            {t("text.format")}
          </Button>
          <Button
            size="small"
            icon={<CompressOutlined />}
            disabled={!input.trim()}
            onClick={() => transform(input, "minify")}
          >
            {t("text.minify")}
          </Button>
        </div>
      </section>
    </div>
  );
}
