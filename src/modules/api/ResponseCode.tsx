import type { ReactNode } from "react";

/** 尝试把 JSON 文本格式化成 2 空格缩进；不是 JSON 时返回 null */
function prettyJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

const JSON_TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlightJson(text: string, seq: { n: number }): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(JSON_TOKEN)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const [raw, str, colon, literal, num] = match;
    if (str !== undefined) {
      if (colon !== undefined) {
        nodes.push(
          <span key={seq.n++} className="tok-key">
            {str}
          </span>,
          <span key={seq.n++} className="tok-punc">
            {colon}
          </span>,
        );
      } else {
        nodes.push(
          <span key={seq.n++} className="tok-str">
            {str}
          </span>,
        );
      }
    } else if (literal !== undefined) {
      nodes.push(
        <span key={seq.n++} className="tok-lit">
          {literal}
        </span>,
      );
    } else if (num !== undefined) {
      nodes.push(
        <span key={seq.n++} className="tok-num">
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

const TAG_TOKEN = /(<!--[\s\S]*?-->)|(<\/?)([A-Za-z][\w:.-]*)([^>]*)>/g;
const ATTR_TOKEN = /([A-Za-z_:][\w:.-]*)(\s*=\s*)("[^"]*"|'[^']*')/g;

function highlightAttrs(raw: string, seq: { n: number }): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of raw.matchAll(ATTR_TOKEN)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(raw.slice(last, start));
    const [whole, name, equals, value] = match;
    nodes.push(
      <span key={seq.n++} className="tok-attr">
        {name}
      </span>,
      <span key={seq.n++} className="tok-punc">
        {equals}
      </span>,
      <span key={seq.n++} className="tok-str">
        {value}
      </span>,
    );
    last = start + whole.length;
  }
  if (last < raw.length) nodes.push(raw.slice(last));
  return nodes;
}

function highlightMarkup(text: string, seq: { n: number }): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TAG_TOKEN)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const [whole, comment, bracket, name, attrs] = match;
    if (comment !== undefined) {
      nodes.push(
        <span key={seq.n++} className="tok-comment">
          {comment}
        </span>,
      );
    } else {
      nodes.push(
        <span key={seq.n++} className="tok-punc">
          {bracket}
        </span>,
        <span key={seq.n++} className="tok-tag">
          {name}
        </span>,
      );
      if (attrs) nodes.push(...highlightAttrs(attrs, seq));
      nodes.push(
        <span key={seq.n++} className="tok-punc">
          {whole.endsWith("/>") ? "/>" : ">"}
        </span>,
      );
    }
    last = start + whole.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function looksLikeMarkup(text: string): boolean {
  return /^\s*<(!doctype|html|head|body|\?xml|[a-z][\w:-]*[\s>])/i.test(text);
}

function isJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** 响应正文高亮：JSON / HTML / XML 上色，其它内容按纯文本展示 */
export default function ResponseCode({
  text,
  pretty,
}: {
  text: string;
  pretty: boolean;
}) {
  const seq = { n: 0 };
  const formatted = pretty ? prettyJson(text) : null;
  if (formatted !== null) {
    return <pre className="api-pre api-code">{highlightJson(formatted, seq)}</pre>;
  }
  if (!pretty && isJson(text)) {
    return <pre className="api-pre api-code">{highlightJson(text, seq)}</pre>;
  }
  if (looksLikeMarkup(text)) {
    return <pre className="api-pre api-code">{highlightMarkup(text, seq)}</pre>;
  }
  return <pre className="api-pre">{text}</pre>;
}
