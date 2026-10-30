import { useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Button, Spin } from "antd";
import { CaretRightOutlined } from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import DbResultGrid from "./DbResultGrid";
import { dbQuery, type DbQueryResult } from "./api";

interface Props {
  connectionId: string;
  database: string | null;
  initialSql?: string;
  onSqlChange?: (sql: string) => void;
}

export default function DbSqlView({
  connectionId,
  database,
  initialSql,
  onSqlChange,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const [sql, setSql] = useState(initialSql ?? "");
  const [result, setResult] = useState<DbQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [editorHeight, setEditorHeight] = useState(320);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const run = async () => {
    const statement = sql.trim();
    if (!statement || running) return;
    setRunning(true);
    setError(null);
    try {
      const next = await dbQuery(connectionId, database, statement);
      setResult(next);
    } catch (reason) {
      setResult(null);
      setError(errText(reason));
    } finally {
      setRunning(false);
    }
  };

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
            type="primary"
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
        <textarea
          className="db-sql-input"
          spellCheck={false}
          value={sql}
          placeholder={t("db.sqlPlaceholder")}
          onChange={(event) => {
            setSql(event.target.value);
            onSqlChange?.(event.target.value);
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void run();
            }
          }}
        />
      </div>

      <div
        className="db-sql-splitter"
        role="separator"
        aria-orientation="horizontal"
        onMouseDown={startResize}
        onDoubleClick={() => setEditorHeight(320)}
      />

      <div className="db-sql-result">
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
