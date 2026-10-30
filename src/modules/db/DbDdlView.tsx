import { useEffect, useState } from "react";
import { Button, Tooltip } from "antd";
import { CaretRightOutlined, ReloadOutlined } from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import { dbExecDdl, dbTableDdl } from "./api";

interface Props {
  connectionId: string;
  database: string;
  table: string;
}

export default function DbDdlView({ connectionId, database, table }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const [sql, setSql] = useState("");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
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

  const run = async () => {
    const statement = sql.trim();
    if (!statement || running) return;
    setRunning(true);
    setError(null);
    try {
      await dbExecDdl(connectionId, statement);
      await load();
    } catch (reason) {
      setError(errText(reason));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="db-ddl-view">
      <div className="db-view-toolbar">
        <span className="db-muted">{t("db.tableDdl")}</span>
        <span style={{ flex: 1 }} />
        <Tooltip title={t("db.refreshData")}>
          <Button size="small" type="text" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()} />
        </Tooltip>
        <Button
          size="small"
          type="primary"
          icon={<CaretRightOutlined />}
          loading={running}
          disabled={!sql.trim()}
          onClick={() => void run()}
        >
          {t("db.runDdl")}
        </Button>
      </div>
      {error && <div className="db-error">{error}</div>}
      <textarea
        className="db-ddl-input"
        spellCheck={false}
        value={sql}
        placeholder={t("db.ddlPlaceholder")}
        onChange={(event) => setSql(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            void run();
          }
        }}
      />
    </div>
  );
}
