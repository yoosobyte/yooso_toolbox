import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Button, Input, Spin, Tooltip } from "antd";
import {
  DeleteOutlined,
  DisconnectOutlined,
  DownOutlined,
  EditOutlined,
  EyeOutlined,
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import type { DbConfig, DbTableInfo } from "./api";
import type { DbQueryDef } from "./queries";
import { connectionColor } from "./colors";
import { DatabaseIcon, MysqlIcon, TableIcon } from "./icons";


interface Props {
  connections: DbConfig[];
  activeId: string | null;
  connectingId: string | null;
  databases: string[];
  activeDatabase: string | null;
  expandedDatabases: Set<string>;
  tablesByDb: Record<string, DbTableInfo[]>;
  selection: { database: string; table: string } | null;
  queries: DbQueryDef[];
  activeQueryId: string | null;
  filter: string;
  connectionExpanded: boolean;
  loadingDatabases: boolean;
  loadingTables: Set<string>;
  error?: string | null;
  onToggleConnection: (config: DbConfig) => void;
  onToggleDatabase: (database: string) => void;
  onFilterChange: (value: string) => void;
  onSelectTable: (database: string, table: string) => void;
  onSelectQuery: (query: DbQueryDef) => void;
  onQueryContextMenu: (event: React.MouseEvent, query: DbQueryDef) => void;
  onTableContextMenu: (
    event: React.MouseEvent,
    database: string,
    table: string,
  ) => void;
  onDatabaseContextMenu: (
    event: React.MouseEvent,
    database: string,
  ) => void;
  onRefresh: () => void;
  onEdit: (config: DbConfig) => void;
  onDelete: (config: DbConfig) => void;
  onDisconnect: (config: DbConfig) => void;
  onNewTable: (database: string) => void;
  onNewDatabase: (config: DbConfig) => void;
}

export default function DbTree({
  connections,
  activeId,
  connectingId,
  databases,
  activeDatabase,
  expandedDatabases,
  tablesByDb,
  selection,
  queries,
  activeQueryId,
  filter,
  connectionExpanded,
  loadingDatabases,
  loadingTables,
  error,
  onToggleConnection,
  onToggleDatabase,
  onFilterChange,
  onSelectTable,
  onSelectQuery,
  onQueryContextMenu,
  onTableContextMenu,
  onDatabaseContextMenu,
  onRefresh,
  onEdit,
  onDelete,
  onDisconnect,
  onNewTable,
  onNewDatabase,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const keyword = filter.trim().toLowerCase();
  const [connMenu, setConnMenu] = useState<{
    x: number;
    y: number;
    config: DbConfig;
  } | null>(null);

  useEffect(() => {
    if (!connMenu) return;
    const close = () => setConnMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [connMenu]);

  const filtered = useMemo(() => {
    const result: Record<string, DbTableInfo[]> = {};
    for (const [database, tables] of Object.entries(tablesByDb)) {
      result[database] = keyword
        ? tables.filter((table) => table.name.toLowerCase().includes(keyword))
        : tables;
    }
    return result;
  }, [tablesByDb, keyword]);

  return (
    <div className="db-tree-card">
      <div className="db-tree-head">
        <DatabaseIcon />
        <span>{t("db.connections")}</span>
        <span className="db-count">{connections.length}</span>
        <Tooltip title={t("db.refresh")}>
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            onClick={onRefresh}
            loading={loadingDatabases}
            disabled={!activeId}
          />
        </Tooltip>
      </div>

      <div className="db-tree-filter">
        <Input
          size="small"
          allowClear
          value={filter}
          prefix={<SearchOutlined style={{ color: "var(--text-mute)" }} />}
          placeholder={t("db.searchTables")}
          onChange={(event) => onFilterChange(event.target.value)}
        />
      </div>

      {connMenu && (
        <div
          className="db-context-menu"
          style={{ left: connMenu.x, top: connMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {connMenu.config.id === activeId && (
            <button
              type="button"
              onClick={() => {
                onDisconnect(connMenu.config);
                setConnMenu(null);
              }}
            >
              <DisconnectOutlined />
              {t("db.disconnect")}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onNewDatabase(connMenu.config);
              setConnMenu(null);
            }}
          >
            <DatabaseIcon />
            {t("db.newDatabase")}
          </button>
          <button
            type="button"
            disabled={!activeDatabase}
            onClick={() => {
              if (!activeDatabase) return;
              onNewTable(activeDatabase);
              setConnMenu(null);
            }}
          >
            <PlusOutlined />
            {t("db.newTable")}
          </button>
          <button
            type="button"
            onClick={() => {
              onEdit(connMenu.config);
              setConnMenu(null);
            }}
          >
            <EditOutlined />
            {t("db.edit")}
          </button>
          <button
            type="button"
            onClick={() => {
              onDelete(connMenu.config);
              setConnMenu(null);
            }}
          >
            <DeleteOutlined />
            {t("common.delete")}
          </button>
        </div>
      )}

      <div className="db-tree-scroll">
        {error && <div className="db-tree-error">{error}</div>}

        {connections.length === 0 && (
          <div className="db-empty">
            <span className="app-empty-glyph">
              <DatabaseIcon />
            </span>
            <div className="app-empty-title">{t("db.emptyTitle")}</div>
            <div className="app-empty-hint">{t("db.emptyConnections")}</div>
          </div>
        )}

        {connections.map((config) => {
          const active = config.id === activeId;
          const connecting = config.id === connectingId;
          const expanded = active && connectionExpanded;
          return (
            <div key={config.id}>
              <div
                className={`db-tree-conn${active ? " active" : ""}`}
                style={{ "--db-conn-color": connectionColor(config.color) } as CSSProperties}
                onClick={() => onToggleConnection(config)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setConnMenu({ x: event.clientX, y: event.clientY, config });
                }}
                role="button"
                tabIndex={0}
                title={`${config.name ? `${config.name} · ` : ""}${config.host}:${config.port}`}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onToggleConnection(config);
                  }
                }}
              >
                <span className="db-tree-caret">
                  {expanded ? <DownOutlined /> : <RightOutlined />}
                </span>
                <MysqlIcon />
                <span className="db-tree-conn-name">
                  {config.name || `${config.host}:${config.port}`}
                </span>
                {connecting && <Spin size="small" />}
                {active && <span className="db-tree-live" />}
              </div>

              {expanded && (
                <>
                  {loadingDatabases && databases.length === 0 && (
                    <div className="db-tree-loading">
                      <Spin size="small" />
                    </div>
                  )}

                  {!loadingDatabases && databases.length === 0 && !error && (
                    <div className="db-empty db-tree-empty">{t("db.noDatabases")}</div>
                  )}

                  {databases.map((database) => {
                    const dbExpanded = expandedDatabases.has(database);
                    const tables = filtered[database];
                    const dbQueries = queries.filter((query) => query.database === database);
                    const tablesLoaded = tablesByDb[database] !== undefined;
                    const tablesLoading = loadingTables.has(database);
                    return (
                      <div key={database}>
                        <div
                          className={`db-tree-db${database === activeDatabase ? " active" : ""}`}
                          onClick={() => onToggleDatabase(database)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            onDatabaseContextMenu(event, database);
                          }}
                          role="button"
                          tabIndex={0}
                          title={database}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onToggleDatabase(database);
                            }
                          }}
                        >
                          <span className="db-tree-caret">
                            {dbExpanded ? <DownOutlined /> : <RightOutlined />}
                          </span>
                          <DatabaseIcon />
                          <span className="db-tree-name">{database}</span>
                          {tablesLoaded && (
                            <span className="db-count">{tablesByDb[database].length}</span>
                          )}
                        </div>

                        {dbExpanded && (
                          <>
                            {tablesLoading && (
                              <div className="db-tree-loading">
                                <Spin size="small" />
                              </div>
                            )}
                            {dbQueries.map((query) => (
                              <div
                                key={query.id}
                                className={`db-tree-query${activeQueryId === query.id ? " active" : ""}`}
                                onClick={() => onSelectQuery(query)}
                                onContextMenu={(event) =>
                                  onQueryContextMenu(event, query)
                                }
                                role="button"
                                tabIndex={0}
                                title={`${query.name} (${database})`}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    onSelectQuery(query);
                                  }
                                }}
                              >
                                <FileTextOutlined />
                                <span className="db-tree-name">{query.name}</span>
                              </div>
                            ))}
                            {!tablesLoading &&
                              tables?.map((table) => {
                                const selected =
                                  selection?.database === database &&
                                  selection?.table === table.name;
                                return (
                                  <div
                                    key={table.name}
                                    className={`db-tree-table${selected ? " active" : ""}`}
                                    onClick={() => onSelectTable(database, table.name)}
                                    onContextMenu={(event) =>
                                      onTableContextMenu(event, database, table.name)
                                    }
                                    role="button"
                                    tabIndex={0}
                                    title={`${database}.${table.name}`}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        onSelectTable(database, table.name);
                                      }
                                    }}
                                  >
                                    {table.kind === "view" ? <EyeOutlined /> : <TableIcon />}
                                    <span className="db-tree-name">{table.name}</span>
                                  </div>
                                );
                              })}
                            {!tablesLoading && tables && tables.length === 0 && dbQueries.length === 0 && (
                              <div className="db-empty db-tree-empty">{t("db.noTables")}</div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
