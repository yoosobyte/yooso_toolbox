import { Segmented } from "antd";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import DbDataView from "./DbDataView";
import DbStructureView from "./DbStructureView";
import DbDdlView from "./DbDdlView";
import DbIndexView from "./DbIndexView";
import DbSettingsView from "./DbSettingsView";

interface Props {
  connectionId: string;
  database: string;
  table: string;
  view: "data" | "structure" | "index" | "settings" | "ddl";
  onViewChange: (view: "data" | "structure" | "index" | "settings" | "ddl") => void;
  onTableRenamed: (table: string) => void;
}

export default function DbTableTab({
  connectionId,
  database,
  table,
  view,
  onViewChange,
  onTableRenamed,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <div className="db-table-tab">
      <div className="db-table-tab-bar">
        <Segmented
          size="small"
          value={view}
          onChange={(next) =>
            onViewChange(next as "data" | "structure" | "index" | "settings" | "ddl")
          }
          options={[
            { value: "data", label: t("db.data") },
            { value: "structure", label: t("db.structure") },
            { value: "index", label: t("db.indexes") },
            { value: "settings", label: t("db.settings") },
            { value: "ddl", label: t("db.ddl") },
          ]}
        />
      </div>

      <div className="db-slot" style={{ display: view === "data" ? "flex" : "none" }}>
        <DbDataView
          connectionId={connectionId}
          database={database}
          table={table}
          refreshToken={0}
        />
      </div>

      {view === "structure" && (
        <div className="db-slot" style={{ display: "flex" }}>
          <DbStructureView
            connectionId={connectionId}
            database={database}
            table={table}
            refreshToken={0}
          />
        </div>
      )}

      {view === "ddl" && (
        <div className="db-slot" style={{ display: "flex" }}>
          <DbDdlView connectionId={connectionId} database={database} table={table} />
        </div>
      )}

      {view === "index" && (
        <div className="db-slot" style={{ display: "flex" }}>
          <DbIndexView connectionId={connectionId} database={database} table={table} />
        </div>
      )}

      {view === "settings" && (
        <div className="db-slot" style={{ display: "flex" }}>
          <DbSettingsView
            connectionId={connectionId}
            database={database}
            table={table}
            onRenamed={onTableRenamed}
          />
        </div>
      )}
    </div>
  );
}
