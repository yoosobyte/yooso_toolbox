import type { ReactNode } from "react";

const JSON_TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** 把 JSON 文本渲染成带颜色的 ReactNode（key / 字符串 / 数字 / 字面量） */
export function highlightJsonText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let seq = 0;
  for (const match of text.matchAll(JSON_TOKEN)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const [raw, str, colon, literal, num] = match;
    if (str !== undefined) {
      if (colon !== undefined) {
        nodes.push(
          <span key={seq++} className="tok-key">
            {str}
          </span>,
          <span key={seq++} className="tok-punc">
            {colon}
          </span>,
        );
      } else {
        nodes.push(
          <span key={seq++} className="tok-str">
            {str}
          </span>,
        );
      }
    } else if (literal !== undefined) {
      nodes.push(
        <span key={seq++} className="tok-lit">
          {literal}
        </span>,
      );
    } else if (num !== undefined) {
      nodes.push(
        <span key={seq++} className="tok-num">
          {num}
        </span>,
      );
    } else {
      nodes.push(raw);
    }
    last = start + raw.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** 尝试把一段文本格式化成 2 空格缩进的 JSON；失败返回 null（不报错） */
export function formatJsonInput(
  raw: string,
  indent: number | string = 2,
): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    return JSON.stringify(JSON.parse(text), null, indent);
  } catch {
    return null;
  }
}

/** 把旧文本里的光标位置映射到格式化后的文本：按「非空白字符个数」对齐 */
export function mapCaret(oldText: string, caret: number, newText: string): number {
  const meaningful = oldText.slice(0, caret).replace(/\s/g, "").length;
  if (meaningful === 0) return 0;
  let count = 0;
  for (let index = 0; index < newText.length; index += 1) {
    if (!/\s/.test(newText[index])) {
      count += 1;
      if (count === meaningful) return index + 1;
    }
  }
  return newText.length;
}

/** 新值相对旧值只是多了/少了空白（回车、空格、Tab）：这种编辑不要触发格式化 */
export function isWhitespaceOnlyChange(prev: string, next: string): boolean {
  if (prev === next) return false;
  return next.replace(/\s/g, "") === prev.replace(/\s/g, "");
}
