import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { App as AntdApp, Button, Tooltip } from "antd";
import { CodeOutlined, CopyOutlined, ReloadOutlined } from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import { copyText } from "../../clipboard";
import { dbTableDdl } from "./api";

interface Props {
  connectionId: string;
  database: string;
  table: string;
}

const SQL_KEYWORDS = new Set([
  "ADD",
  "AFTER",
  "ALL",
  "ALTER",
  "AND",
  "AS",
  "AUTO_INCREMENT",
  "BETWEEN",
  "BY",
  "CASCADE",
  "CHANGE",
  "CHARACTER",
  "CHARSET",
  "COLLATE",
  "COLUMN",
  "COMMENT",
  "CONSTRAINT",
  "CREATE",
  "DEFAULT",
  "DELETE",
  "DROP",
  "ENGINE",
  "EXISTS",
  "FIRST",
  "FOREIGN",
  "FROM",
  "FULLTEXT",
  "IF",
  "INDEX",
  "INSERT",
  "INTO",
  "KEY",
  "LIKE",
  "MODIFY",
  "NOT",
  "NULL",
  "ON",
  "OR",
  "ORDER",
  "PRIMARY",
  "REFERENCES",
  "RENAME",
  "REPLACE",
  "RESTRICT",
  "SET",
  "TABLE",
  "TO",
  "TRUNCATE",
  "UNIQUE",
  "UPDATE",
  "USING",
  "VALUES",
  "WHERE",
  "WITH",
  "ZEROFILL",
]);

const SQL_TYPES = new Set([
  "BIGINT",
  "BINARY",
  "BIT",
  "BLOB",
  "BOOLEAN",
  "CHAR",
  "DATE",
  "DATETIME",
  "DECIMAL",
  "DOUBLE",
  "ENUM",
  "FLOAT",
  "INT",
  "INTEGER",
  "JSON",
  "LONGBLOB",
  "LONGTEXT",
  "MEDIUMBLOB",
  "MEDIUMINT",
  "MEDIUMTEXT",
  "NUMERIC",
  "SET",
  "SMALLINT",
  "TEXT",
  "TIME",
  "TIMESTAMP",
  "TINYBLOB",
  "TINYINT",
  "TINYTEXT",
  "VARBINARY",
  "VARCHAR",
  "YEAR",
]);

const SQL_FUNCTIONS = new Set([
  "CURRENT_DATE",
  "CURRENT_TIME",
  "CURRENT_TIMESTAMP",
  "NOW",
]);

const SQL_TOKEN_RE =
  /(--[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|('(?:''|\\.|[^'])*')|("(?:""|\\.|[^"])*")|(`(?:``|[^`])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_$]*)|(\s+)|([^\sA-Za-z0-9_$]+)/g;

function highlightSql(sql: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let match: RegExpExecArray | null;
  let index = 0;
  SQL_TOKEN_RE.lastIndex = 0;
  while ((match = SQL_TOKEN_RE.exec(sql)) !== null) {
    const token = match[0];
    let className = "";
    if (match[1]) className = "sql-comment";
    else if (match[2] || match[3]) className = "sql-string";
    else if (match[4]) className = "sql-identifier";
    else if (match[5]) className = "sql-number";
    else if (match[6]) {
      const upper = token.toUpperCase();
      if (SQL_KEYWORDS.has(upper)) className = "sql-keyword";
      else if (SQL_TYPES.has(upper)) className = "sql-type";
      else if (SQL_FUNCTIONS.has(upper)) className = "sql-keyword";
    } else if (match[7]) {
      nodes.push(token);
      index += 1;
      continue;
    } else className = "sql-punct";
    nodes.push(
      <span key={index} className={className}>
        {token}
      </span>,
    );
    index += 1;
  }
  return nodes;
}

export default function DbDdlView({ connectionId, database, table }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const { message } = AntdApp.useApp();
  const [sql, setSql] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setSql(await dbTableDdl(connectionId, database, table));
    } catch (reason) {
      setError(errText(reason));
      setSql("");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, database, table]);

  const copy = () => {
    if (!sql.trim()) return;
    void copyText(sql).then(
      () => message.success(t("db.ddlCopied")),
      () => message.error(t("common.copyFailed")),
    );
  };

  return (
    <div className="db-ddl-view">
      <div className="db-view-toolbar">
        <Button size="small" type="text" icon={<CodeOutlined />}>
          {t("db.ddl")}
        </Button>
        <span style={{ flex: 1 }} />
        <Tooltip title={t("db.refreshData")}>
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void load()}
          />
        </Tooltip>
        <Button
          size="small"
          icon={<CopyOutlined />}
          disabled={!sql.trim()}
          onClick={copy}
        >
          {t("db.copyDdl")}
        </Button>
      </div>
      {error && <div className="db-error">{error}</div>}
      <pre className="db-ddl-code" aria-label={t("db.ddl")}>
        {sql ? (
          highlightSql(sql)
        ) : (
          <span className="db-ddl-empty">{t("db.ddlPlaceholder")}</span>
        )}
      </pre>
    </div>
  );
}
