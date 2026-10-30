import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { diffLines } from "./diff";

interface Highlight {
  left: Set<number>;
  right: Set<number>;
  changed: number;
  /** 文本过长，已关闭逐行高亮 */
  off: boolean;
}

const EMPTY: Highlight = {
  left: new Set(),
  right: new Set(),
  changed: 0,
  off: false,
};

const MAX_HIGHLIGHT_LINES = 4000;

function lineCount(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function sameSet(a: Set<number>, b: Set<number>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/** 打字时先不动 diff/高亮，停手后再更新，避免每敲一个字都重建整棵高亮 DOM */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

interface MirrorLinesProps {
  lines: string[];
  changed: Set<number>;
  off: boolean;
  hasContent: boolean;
}

const MirrorLines = memo(function MirrorLines({
  lines,
  changed,
  off,
  hasContent,
}: MirrorLinesProps) {
  return (
    <>
      {lines.map((line, index) => {
        const isChanged = changed.has(index + 1);
        const isSame = !off && !isChanged && hasContent;
        return (
          <div
            className={`txt-mirror-line${isChanged ? " is-change" : isSame ? " is-same" : ""}`}
            key={index}
          >
            {line || "\u00a0"}
          </div>
        );
      })}
    </>
  );
});

export default function TextDiff() {
  const t = useT(useUiStore((state) => state.lang));

  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const settledLeft = useDebouncedValue(left, 200);
  const settledRight = useDebouncedValue(right, 200);
  const [highlight, setHighlight] = useState<Highlight>(EMPTY);

  const [minHeight, setMinHeight] = useState(0);
  const minHeightRef = useRef(0);
  const supportsFieldSizing = useMemo(() => {
    try {
      return typeof CSS !== "undefined" && CSS.supports("field-sizing", "content");
    } catch {
      return false;
    }
  }, []);
  const leftInput = useRef<HTMLTextAreaElement | null>(null);
  const rightInput = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 文本停手 200ms 后做行级对比；未变化的一侧复用旧 Set，避免整栏重渲染
  useEffect(() => {
    const leftLines = lineCount(settledLeft);
    const rightLines = lineCount(settledRight);
    if (leftLines > MAX_HIGHLIGHT_LINES || rightLines > MAX_HIGHLIGHT_LINES) {
      setHighlight((prev) => (prev.off ? prev : { ...EMPTY, off: true }));
      return;
    }
    const result = diffLines(settledLeft, settledRight);
    const changedLeft = new Set<number>();
    const changedRight = new Set<number>();
    for (const row of result.rows) {
      if (row.kind === "same") continue;
      if (row.oldLine !== null) changedLeft.add(row.oldLine);
      if (row.newLine !== null) changedRight.add(row.newLine);
    }
    const changed = Math.max(changedLeft.size, changedRight.size);
    setHighlight((prev) => {
      const nextLeft = sameSet(prev.left, changedLeft) ? prev.left : changedLeft;
      const nextRight = sameSet(prev.right, changedRight) ? prev.right : changedRight;
      if (nextLeft === prev.left && nextRight === prev.right && prev.changed === changed && !prev.off) {
        return prev;
      }
      return { left: nextLeft, right: nextRight, changed, off: false };
    });
  }, [settledLeft, settledRight]);

  // 记录可视区高度，用来给两个输入框垫底（短文本时也能点满整栏）
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => {
      minHeightRef.current = element.clientHeight;
      setMinHeight(element.clientHeight);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 输入框高度跟内容走：自身不滚动，滚动交给外层同一个容器 -> 两边天然同步。
  // 支持 field-sizing: content 的浏览器交给 CSS，避免每次按键读 scrollHeight 触发布局。
  useEffect(() => {
    if (supportsFieldSizing) return;
    const frame = window.requestAnimationFrame(() => {
      const fit = (input: HTMLTextAreaElement | null) => {
        if (!input) return;
        input.style.height = "auto";
        input.style.height = `${Math.max(Math.ceil(input.scrollHeight), minHeightRef.current)}px`;
      };
      fit(leftInput.current);
      fit(rightInput.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [left, right, minHeight, supportsFieldSizing]);

  const leftLines = useMemo(() => settledLeft.split("\n"), [settledLeft]);
  const rightLines = useMemo(() => settledRight.split("\n"), [settledRight]);

  const focusInput = (input: HTMLTextAreaElement | null) => {
    if (!input) return;
    const end = input.value.length;
    input.setSelectionRange(end, end);
    input.focus();
  };

  const hasContent = left !== "" || right !== "";
  const badgeTone = highlight.off ? "muted" : highlight.changed > 0 ? "danger" : "success";
  const badgeText = highlight.off
    ? t("text.highlightOff")
    : highlight.changed > 0
      ? t("text.different", { count: highlight.changed })
      : t("text.noDifference");

  return (
    <div className="txt-body txt-diff-body">
      <section className="txt-diff-card">
        <div className="txt-diff-heads">
          <div className="txt-panel-head">
            <span className="txt-panel-title">{t("text.original")}</span>
            <span className="txt-hint">{t("text.lineCount", { count: lineCount(left) })}</span>
          </div>
          <div className="txt-panel-head">
            <span className="txt-panel-title">{t("text.changed")}</span>
            <span className="txt-hint">{t("text.lineCount", { count: lineCount(right) })}</span>
            <span style={{ flex: 1 }} />
            {hasContent && (
              <span className={`txt-diff-badge txt-diff-${badgeTone}`}>{badgeText}</span>
            )}
          </div>
        </div>

        <div className="txt-shared-scroll" ref={scrollRef}>
          <div className="txt-diff-cols">
            <div
              className="txt-col"
              onMouseDown={(event) => {
                if (event.target !== event.currentTarget) return;
                event.preventDefault();
                focusInput(leftInput.current);
              }}
            >
              <pre className="txt-mirror" aria-hidden>
                <MirrorLines
                  lines={leftLines}
                  changed={highlight.left}
                  off={highlight.off}
                  hasContent={hasContent}
                />
              </pre>
              <textarea
                ref={leftInput}
                className="txt-pane-input"
                style={{ minHeight: minHeight || undefined }}
                value={left}
                spellCheck={false}
                placeholder={t("text.originalPlaceholder")}
                onChange={(event) => setLeft(event.target.value)}
              />
            </div>

            <div
              className="txt-col"
              onMouseDown={(event) => {
                if (event.target !== event.currentTarget) return;
                event.preventDefault();
                focusInput(rightInput.current);
              }}
            >
              <pre className="txt-mirror" aria-hidden>
                <MirrorLines
                  lines={rightLines}
                  changed={highlight.right}
                  off={highlight.off}
                  hasContent={hasContent}
                />
              </pre>
              <textarea
                ref={rightInput}
                className="txt-pane-input"
                style={{ minHeight: minHeight || undefined }}
                value={right}
                spellCheck={false}
                placeholder={t("text.changedPlaceholder")}
                onChange={(event) => setRight(event.target.value)}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
