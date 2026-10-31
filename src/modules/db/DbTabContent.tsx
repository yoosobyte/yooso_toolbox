import type { DbQueryDef } from "./queries";
import type { DbTabView, TableTab } from "./dbModuleTypes";
import DbTableTab from "./DbTableTab";
import DbSqlView from "./DbSqlView";

interface Props {
  connectionId: string;
  tableTabs: TableTab[];
  openQueries: DbQueryDef[];
  effectiveTabKey: string | null;
  onViewChange: (key: string, view: DbTabView) => void;
  onTableRenamed: (database: string, oldTable: string, newTable: string) => void;
  onSqlChange: (id: string, sql: string) => void;
}

/** 页签内容区：每个页签一个常驻 slot，仅通过 display 切换可见性 */
export default function DbTabContent({
  connectionId,
  tableTabs,
  openQueries,
  effectiveTabKey,
  onViewChange,
  onTableRenamed,
  onSqlChange,
}: Props) {
  return (
    <div className="db-tab-content">
      {tableTabs.map((tab) => (
        <div
          key={tab.key}
          className="db-slot"
          style={{ display: effectiveTabKey === tab.key ? "flex" : "none" }}
        >
          <DbTableTab
            connectionId={connectionId}
            database={tab.database}
            table={tab.table}
            view={tab.view}
            onViewChange={(view) => onViewChange(tab.key, view)}
            onTableRenamed={(newName) =>
              onTableRenamed(tab.database, tab.table, newName)
            }
          />
        </div>
      ))}

      {openQueries.map((query) => {
        const key = `q:${query.id}`;
        return (
          <div
            key={key}
            className="db-slot"
            style={{ display: effectiveTabKey === key ? "flex" : "none" }}
          >
            <DbSqlView
              connectionId={connectionId}
              database={query.database}
              initialSql={query.sql}
              onSqlChange={(sql) => onSqlChange(query.id, sql)}
            />
          </div>
        );
      })}
    </div>
  );
}
