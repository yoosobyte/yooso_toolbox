import { marked } from "marked";
import type { Token, Tokens } from "marked";
import { Fragment, type ReactNode } from "react";

/**
 * 用 marked 解析 Markdown（GFM），再把 token 树渲染成 React 元素。
 * 不输出原始 HTML，避免 XSS；无法处理的 HTML 片段按原文显示。
 */

function safeHref(href: string): string | null {
  const value = href.trim();
  if (!value) return null;
  return /^(https?:\/\/|mailto:|#|\/)/i.test(value) ? value : null;
}

function safeImageSrc(src: string): string | null {
  const value = src.trim();
  if (!value) return null;
  return /^(https?:\/\/|data:image\/)/i.test(value) ? value : null;
}

function renderInline(tokens: Token[] | undefined, keyPrefix: string): ReactNode[] {
  if (!tokens || tokens.length === 0) return [];
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case "text":
        return token.tokens && token.tokens.length > 0 ? (
          <span key={key}>{renderInline(token.tokens, key)}</span>
        ) : (
          token.text
        );
      case "escape":
        return token.text;
      case "strong":
        return <strong key={key}>{renderInline(token.tokens, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(token.tokens, key)}</em>;
      case "del":
        return <del key={key}>{renderInline(token.tokens, key)}</del>;
      case "codespan":
        return <code key={key}>{token.text}</code>;
      case "br":
        return <br key={key} />;
      case "link": {
        const href = safeHref(token.href);
        const label = renderInline(token.tokens, key);
        return href ? (
          <a key={key} href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        ) : (
          <span key={key}>{label}</span>
        );
      }
      case "image": {
        const src = safeImageSrc(token.href);
        return src ? (
          <img
            key={key}
            src={src}
            alt={token.text}
            title={token.title ?? undefined}
          />
        ) : (
          <span key={key}>{token.text}</span>
        );
      }
      case "html":
        return token.text;
      case "checkbox":
        return (
          <input
            key={key}
            type="checkbox"
            checked={Boolean(token.checked)}
            readOnly
          />
        );
      default:
        return token.raw ?? "";
    }
  });
}

function renderListItem(item: Tokens.ListItem, key: string): ReactNode {
  const children: ReactNode[] = [];
  item.tokens.forEach((token, index) => {
    const childKey = `${key}-${index}`;
    if (token.type === "text" || token.type === "paragraph") {
      children.push(
        <Fragment key={childKey}>{renderInline(token.tokens, childKey)}</Fragment>,
      );
      return;
    }
    children.push(renderBlock(token, childKey));
  });

  if (item.task) {
    return (
      <li key={key} className="note-md-task">
        <input type="checkbox" checked={Boolean(item.checked)} readOnly />
        <span>{children}</span>
      </li>
    );
  }
  return <li key={key}>{children}</li>;
}

function renderList(token: Tokens.List, key: string): ReactNode {
  const items = token.items.map((item, index) =>
    renderListItem(item, `${key}-${index}`),
  );
  if (token.ordered) {
    const start = typeof token.start === "number" ? token.start : 1;
    return (
      <ol key={key} start={start}>
        {items}
      </ol>
    );
  }
  return <ul key={key}>{items}</ul>;
}

function renderTable(token: Tokens.Table, key: string): ReactNode {
  return (
    <div className="note-md-table-wrap" key={key}>
      <table>
        <thead>
          <tr>
            {token.header.map((cell, index) => (
              <th key={index} style={{ textAlign: token.align[index] ?? undefined }}>
                {renderInline(cell.tokens, `${key}-h${index}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {token.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  style={{ textAlign: token.align[cellIndex] ?? undefined }}
                >
                  {renderInline(cell.tokens, `${key}-r${rowIndex}c${cellIndex}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderBlock(token: Token, key: string): ReactNode {
  switch (token.type) {
    case "space":
    case "def":
      return null;
    case "heading": {
      const heading = token as Tokens.Heading;
      const depth = Math.min(6, Math.max(1, heading.depth));
      const Tag = `h${depth}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag key={key}>{renderInline(heading.tokens, key)}</Tag>;
    }
    case "paragraph":
      return (
        <p key={key}>
          {renderInline((token as Tokens.Paragraph).tokens, key)}
        </p>
      );
    case "text":
      return (
        <p key={key}>{renderInline((token as Tokens.Text).tokens, key)}</p>
      );
    case "code": {
      const code = token as Tokens.Code;
      return (
        <pre key={key}>
          <code className={code.lang ? `language-${code.lang}` : undefined}>
            {code.text}
          </code>
        </pre>
      );
    }
    case "blockquote":
      return (
        <blockquote key={key}>
          {renderBlocks((token as Tokens.Blockquote).tokens, key)}
        </blockquote>
      );
    case "hr":
      return <hr key={key} />;
    case "list":
      return renderList(token as Tokens.List, key);
    case "table":
      return renderTable(token as Tokens.Table, key);
    case "html":
      return (
        <pre key={key} className="note-md-html">
          {(token as Tokens.HTML).text}
        </pre>
      );
    default:
      return null;
  }
}

function renderBlocks(tokens: Token[], keyPrefix = "b"): ReactNode[] {
  return tokens.map((token, index) => renderBlock(token, `${keyPrefix}-${index}`));
}

export function renderMarkdown(source: string): ReactNode {
  const tokens = marked.lexer(source, { gfm: true, breaks: true });
  const nodes = renderBlocks(tokens);
  return nodes.length > 0 ? nodes : <p className="note-md-empty">—</p>;
}
