import { useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Button, Spin } from "antd";
import { CaretRightOutlined } from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import DbResultGrid from "./DbResultGrid";
import { dbQuery, type DbQueryResult } from "./api";
import { highlightSql } from "./sqlHighlight";

interface Props {
  connectionId: string;
  database: string | null;
  initialSql?: string;
  onSqlChange?: (sql: string) => void;
}

interface SqlResult {
  statement: string;
  result: DbQueryResult | null;
  error: string | null;
}

function splitSqlStatements(input: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (lineComment) {
      current += char;
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (quote) {
      current += char;
      if (char === "\\" && quote !== "`") {
        if (next) {
          current += next;
          index += 1;
        }
        continue;
      }
      if (char === quote) {
        if (next === quote) {
          current += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "-" && next === "-") {
      lineComment = true;
      current += char;
      continue;
    }
    if (char === "#") {
      lineComment = true;
      current += char;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      current += char;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }
    current += char;
  }

  const statement = current.trim();
  if (statement) statements.push(statement);
  return statements;
}

export default function DbSqlView({
  connectionId,
  database,
  initialSql,
  onSqlChange,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const [sql, setSql] = useState(initialSql ?? "");
  const [results, setResults] = useState<SqlResult[]>([]);
  const [activeResult, setActiveResult] = useState(0);
  const [running, setRunning] = useState(false);
  const [editorHeight, setEditorHeight] = useState(320);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);

  const run = async () => {
    const statements = splitSqlStatements(sql);
    if (statements.length === 0 || running) return;

    setRunning(true);
    setResults([]);
    setActiveResult(0);
    const collected: SqlResult[] = [];

    try {
      for (const statement of statements) {
        try {
          const next = await dbQuery(connectionId, database, statement);
          collected.push({ statement, result: next, error: null });
          setResults([...collected]);
        } catch (reason) {
          collected.push({ statement, result: null, error: errText(reason) });
          setResults([...collected]);
          setActiveResult(collected.length - 1);
          break;
        }
      }
    } finally {
      setRunning(false);
    }
  };

  const current = results[activeResult] ?? null;
  const result = current?.result ?? null;
  const error = current?.error ?? null;
  const hasRows = (result?.columns.length ?? 0) > 0;

  const startResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = editorHeight;
    const containerHeight = containerRef.current?.getBoundingClientRect().height ?? 700;
    const maxHeight = Math.max(180, containerHeight - 140);
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: MouseEvent) => {
      const next = Math.max(140, Math.min(maxHeight, startHeight + moveEvent.clientY - startY));
      setEditorHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="db-sql-view" ref={containerRef}>
      <div className="db-sql-editor-wrap" style={{ height: editorHeight }}>
        <div className="db-sql-toolbar">
          <Button
            type="default"
            size="small"
            icon={<CaretRightOutlined />}
            loading={running}
            disabled={!sql.trim()}
            onClick={() => void run()}
          >
            {running ? t("db.running") : t("db.run")}
          </Button>
          <span className="db-hint">{t("db.sqlHint")}</span>
          <span style={{ flex: 1 }} />
          <span className="db-sql-db">
            {database ? t("db.databaseLabel") + ": " + database : t("db.noDatabase")}
          </span>
        </div>
        <div className="db-sql-editor">
          <pre
            ref={highlightRef}
            className="db-sql-highlight"
            aria-hidden="true"
          >
            {highlightSql(sql)}
          </pre>
          <textarea
            className="db-sql-input"
            spellCheck={false}
            wrap="off"
            value={sql}
            placeholder={t("db.sqlPlaceholder")}
            onChange={(event) => {
              setSql(event.target.value);
              onSqlChange?.(event.target.value);
            }}
            onScroll={(event) => {
              const highlight = highlightRef.current;
              if (!highlight) return;
              highlight.scrollTop = event.currentTarget.scrollTop;
              highlight.scrollLeft = event.currentTarget.scrollLeft;
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                void run();
              }
            }}
          />
        </div>
      </div>

      <div
        className="db-sql-splitter"
        role="separator"
        aria-orientation="horizontal"
        onMouseDown={startResize}
        onDoubleClick={() => setEditorHeight(320)}
      />

      <div className="db-sql-result">
        {results.length > 1 && (
          <div className="db-sql-result-tabs">
            {results.map((item, index) => (
              <button
                key={index}
                type="button"
                className={`db-sql-result-tab${activeResult === index ? " active" : ""}`}
                title={item.statement}
                onClick={() => setActiveResult(index)}
              >
                {t("db.result", { index: index + 1 })}
              </button>
            ))}
          </div>
        )}
        <div className="db-sql-status">
          {running ? (
            <span className="db-muted">
              <Spin size="small" /> {t("db.running")}
            </span>
          ) : error ? (
            <span className="db-sql-error-text">{error}</span>
          ) : result ? (
            <>
              <span>
                {hasRows
                  ? t("db.rows", { count: result.rows.length })
                  : t("db.affectedRows", { count: result.affectedRows })}
              </span>
              <span className="db-muted">
                {result.elapsedMs} ms
                {result.lastInsertId != null ? ` · ID ${result.lastInsertId}` : ""}
              </span>
              {result.message && <span className="db-muted">{result.message}</span>}
            </>
          ) : (
            <span className="db-muted">{t("db.sqlResultHint")}</span>
          )}
        </div>

        <div className="db-grid-area">
          {error ? (
            <div className="db-error">{error}</div>
          ) : result && hasRows ? (
            <DbResultGrid columns={result.columns} rows={result.rows} />
          ) : (
            <div className="db-grid-empty">
              {result ? t("db.emptyResult") : t("db.sqlEmpty")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
