import { useEffect, useState } from "react";
import { App as AntdApp, Button, Tooltip } from "antd";
import { CodeOutlined, CopyOutlined, ReloadOutlined } from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import { copyText } from "../../clipboard";
import { dbTableDdl } from "./api";
import { highlightSql } from "./sqlHighlight";

interface Props {
  connectionId: string;
  database: string;
  table: string;
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
