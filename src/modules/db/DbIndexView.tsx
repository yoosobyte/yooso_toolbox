import { useEffect, useRef, useState } from "react";
import { Button, Tooltip } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import DbResultGrid from "./DbResultGrid";
import { dbTableIndexes, type DbQueryResult } from "./api";

interface Props {
  connectionId: string;
  database: string;
  table: string;
}

export default function DbIndexView({ connectionId, database, table }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const [result, setResult] = useState<DbQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    dbTableIndexes(connectionId, database, table)
      .then((next) => {
        if (current === request.current) setResult(next);
      })
      .catch((reason) => {
        if (current !== request.current) return;
        setResult(null);
        setError(errText(reason));
      })
      .finally(() => {
        if (current === request.current) setLoading(false);
      });
  }, [connectionId, database, table, reload]);

  return (
    <div className="db-index-view">
      <div className="db-view-toolbar">
        <span className="db-muted">{t("db.tableIndexes")}</span>
        <span style={{ flex: 1 }} />
        <Tooltip title={t("db.refreshData")}>
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => setReload((value) => value + 1)}
          />
        </Tooltip>
      </div>
      <div className="db-grid-area">
        {error ? (
          <div className="db-error">{error}</div>
        ) : (
          <DbResultGrid
            columns={result?.columns ?? []}
            rows={result?.rows ?? []}
            loading={loading}
            emptyText={t("db.emptyResult")}
          />
        )}
      </div>
      <div className="db-pager">
        <span style={{ flex: 1 }} />
        <span className="db-total">
          {t("db.indexCount", { count: result?.rows.length ?? 0 })}
        </span>
      </div>
    </div>
  );
}
