import { useEffect, useMemo, useRef, useState } from "react";
import { App as AntdApp, Button, Segmented, Select } from "antd";
import {
  FileTextOutlined,
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
import {
  formatJsonInput,
  highlightJsonText,
  isWhitespaceOnlyChange,
  mapCaret,
} from "./jsonHighlight";

const SAMPLE = JSON.stringify(
  {
    requestId: "0b6f1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d",
    traceId: "trace-2026-11-01T08:30:00.123Z-1a2b3c4d5e6f7g8h9i0j",
    endpoint:
      "https://api.example.com/v2/organizations/org_9f8e7d6c/projects/proj_5a4b3c2d/resources",
    status: "SUCCEEDED_WITH_WARNINGS_PARTIAL_RETRY_SUGGESTED",
    durationMs: 12734,
    user: {
      id: "usr_0123456789abcdef",
      displayName: "张三（高级平台架构师 / 基础架构与可观测性团队）",
      email: "zhangsan.platform-architecture@example-internal-domain.com",
    },
    organization: {
      id: "org_9f8e7d6c",
      name: "示例科技（中国）有限公司 - 平台工程中心 - 基础架构组",
      billingAccount: "acct_00112233445566778899",
    },
    resources: [
      "https://cdn.example.com/assets/images/2026/11/01/very-long-file-name-for-testing-horizontal-width.png",
      "https://cdn.example.com/assets/documents/2026/11/01/quarterly-platform-reliability-review-final-v12-signed.pdf",
      "https://cdn.example.com/assets/archives/2026/11/01/metrics-export-2026-11-01T08-30-00Z.tar.gz",
    ],
    metrics: {
      cpuUtilizationPercent: 87.42,
      memoryUtilizationPercent: 93.18,
      diskReadBytesPerSecond: 104857600,
      diskWriteBytesPerSecond: 209715200,
      networkInBytesPerSecond: 1258291.2,
      networkOutBytesPerSecond: 838860.8,
    },
    labels: {
      environment: "production-cn-east-1",
      service: "platform-observability-collector",
      version: "v3.14.159-rc.2+build.20261101",
      team: "platform-architecture-observability",
      costCenter: "CC-1042-PLATFORM-INFRASTRUCTURE",
    },
    slo: {
      availabilityTargetPercent: 99.95,
      availabilityActualPercent: 99.87,
      latencyP99TargetMs: 250,
      latencyP99ActualMs: 412,
      errorBudgetRemainingPercent: 38.2,
      burnRate: 2.75,
    },
    incidents: [
      {
        id: "inc_001",
        title:
          "Upstream database connection pool exhaustion causing elevated API latency",
        severity: "SEV-2",
        startedAt: "2026-11-01T06:12:44.001Z",
        resolvedAt: "2026-11-01T07:48:19.887Z",
      },
    ],
    featureFlags: {
      enable_new_scheduler_v2: true,
      enable_experimental_batching_pipeline: false,
      enable_shadow_traffic_mirroring_for_canary: true,
    },
    regions: {
      "cn-east-1": "healthy",
      "cn-north-1": "degraded",
      "cn-south-1": "healthy",
      "ap-southeast-1": "unavailable",
    },
    retryPolicy: {
      maxAttempts: 5,
      initialBackoffMs: 500,
      maxBackoffMs: 32000,
      backoffMultiplier: 2,
      jitter: true,
    },
    checksum:
      "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    trackingUrl:
      "https://tracking.example.com/click?ad=platform-campaign-2026-q4&campaign=reliability-review&source=observability-collector&medium=internal-report&content=quarterly-summary-with-extra-long-descriptive-parameters&term=api+latency+p99+degradation+incident+investigation&utm_referrer=https%3A%2F%2Fconsole.example.com%2Forganizations%2Forg_9f8e7d6c%2Fprojects%2Fproj_5a4b3c2d%2Fdashboards%2Fplatform-overview",
    deep: {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                level6: {
                  note: "六层嵌套，用来测试缩进与折叠层级",
                  leaf: [1, 2, 3],
                },
              },
            },
          },
        },
      },
    },
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
  const caretRef = useRef<{ start: number; end: number } | null>(null);

  /* 自动格式化后恢复光标，避免跳到末尾 */
  useEffect(() => {
    const caret = caretRef.current;
    if (!caret) return;
    caretRef.current = null;
    const element = inputRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(caret.start, caret.end);
  }, [input]);

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
          <Segmented
            size="small"
            value={view}
            onChange={(next) => showTree(next === "tree")}
            options={[
              { value: "tree", label: t("text.tree") },
              { value: "text", label: t("text.raw") },
            ]}
          />
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
                  onChange={(event) => {
                    const raw = event.target.value;
                    // 只是敲了回车 / 空格 / Tab：原样保留，绝不格式化
                    if (isWhitespaceOnlyChange(input, raw)) {
                      setInput(raw);
                      return;
                    }
                    // 非空白编辑：解析成功就格式化，缩进跟随下方选项
                    const formatted = formatJsonInput(
                      raw,
                      indent === "tab" ? "\t" : Number(indent),
                    );
                    if (formatted !== null && formatted !== raw) {
                      const element = event.currentTarget;
                      caretRef.current = {
                        start: mapCaret(raw, element.selectionStart, formatted),
                        end: mapCaret(raw, element.selectionEnd, formatted),
                      };
                      setInput(formatted);
                      return;
                    }
                    setInput(raw);
                  }}
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
            onChange={(value) => {
              setIndent(value);
              // 缩进变化时立刻按新缩进重新格式化一次
              const formatted = formatJsonInput(
                input,
                value === "tab" ? "\t" : Number(value),
              );
              if (formatted !== null) setInput(formatted);
            }}
            className="txt-indent-select"
            options={[
              { value: "2", label: "2" },
              { value: "4", label: "4" },
              { value: "tab", label: "Tab" },
            ]}
          />
          <span style={{ flex: 1 }} />
          <Button
            size="small"
            icon={<FileTextOutlined />}
            onClick={() => transform(SAMPLE, "format", false)}
          >
            {t("text.sample")}
          </Button>
          <Button size="small" icon={<ClearOutlined />} onClick={clear}>
            {t("text.clear")}
          </Button>
          <Button
            size="small"
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
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={copyOutput}
            disabled={!input.trim()}
          >
            {t("common.copy")}
          </Button>
        </div>
      </section>
    </div>
  );
}
