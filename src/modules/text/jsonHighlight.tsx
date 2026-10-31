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
