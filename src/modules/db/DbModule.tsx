import { useEffect, useRef, useState } from "react";
import { App as AntdApp, Button, Typography } from "antd";
import {
  ClearOutlined,
  CloseOutlined,
  ConsoleSqlOutlined,
  CopyOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useDbStore } from "../../stores/dbStore";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import DbForm from "./DbForm";
import DbTree from "./DbTree";
import { DatabaseIcon } from "./icons";
import DbTableTab from "./DbTableTab";
import DbSqlView from "./DbSqlView";
import DbNewTableModal from "./DbNewTableModal";
import DbCloneTableModal from "./DbCloneTableModal";
import {
  dbConnect,
  dbDatabases,
  dbDisconnect,
  dbExecDdl,
  dbTables,
  type DbConfig,
  type DbConnectInfo,
  type DbTableInfo,
} from "./api";
import { qualified } from "./ddl";

interface TableTab {
  key: string;
  database: string;
  table: string;
  view: "data" | "structure" | "index" | "settings" | "ddl";
}

const SYSTEM_DATABASES = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

function pickDatabase(databases: string[], preferred: string | null): string | null {
  if (preferred && databases.includes(preferred)) return preferred;
  return (
    databases.find((name) => !SYSTEM_DATABASES.has(name.toLowerCase())) ??
    databases[0] ??
    null
  );
}

export default function DbModule() {
  const t = useT(useUiStore((state) => state.lang));
  const { message, modal } = AntdApp.useApp();
  const connections = useDbStore((state) => state.connections);
  const load = useDbStore((state) => state.load);
  const markUsed = useDbStore((state) => state.markUsed);

  const [active, setActive] = useState<DbConfig | null>(null);
  const [info, setInfo] = useState<DbConnectInfo | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [activeDatabase, setActiveDatabase] = useState<string | null>(null);
  const [expandedDatabases, setExpandedDatabases] = useState<Set<string>>(new Set());
  const [tablesByDb, setTablesByDb] = useState<Record<string, DbTableInfo[]>>({});
  const [connectionExpanded, setConnectionExpanded] = useState(true);
  const [tableTabs, setTableTabs] = useState<TableTab[]>([]);
  const [activeTabKey, setActiveTabKey] = useState("sql");
  const [tableFilter, setTableFilter] = useState("");
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [loadingTableDbs, setLoadingTableDbs] = useState<Set<string>>(new Set());
  const [treeError, setTreeError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DbConfig | null>(null);
  const [newTableOpen, setNewTableOpen] = useState(false);
  const [cloneTarget, setCloneTarget] = useState<{
    database: string;
    table: string;
    withData: boolean;
  } | null>(null);
  const [tableMenu, setTableMenu] = useState<{
    x: number;
    y: number;
    database: string;
    table: string;
  } | null>(null);

  const dbRequest = useRef(0);
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!tableMenu) return;
    const close = () => setTableMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [tableMenu]);

  const clearTabs = () => {
    setTableTabs([]);
    setActiveTabKey("sql");
  };

  const loadTablesFor = async (connectionId: string, database: string) => {
    setLoadingTableDbs((prev) => new Set(prev).add(database));
    setTreeError(null);
    try {
      const list = await dbTables(connectionId, database);
      if (activeIdRef.current !== connectionId) return;
      setTablesByDb((prev) => ({ ...prev, [database]: list }));
    } catch (error) {
      if (activeIdRef.current !== connectionId) return;
      setTreeError(errText(error));
    } finally {
      if (activeIdRef.current === connectionId) {
        setLoadingTableDbs((prev) => {
          const next = new Set(prev);
          next.delete(database);
          return next;
        });
      }
    }
  };

  const loadDatabases = async (connectionId: string, preferred: string | null) => {
    const request = ++dbRequest.current;
    setLoadingDatabases(true);
    setTreeError(null);
    setDatabases([]);
    setExpandedDatabases(new Set());
    setTablesByDb({});
    setLoadingTableDbs(new Set());
    try {
      const list = await dbDatabases(connectionId);
      if (request !== dbRequest.current || activeIdRef.current !== connectionId) return;
      setDatabases(list);
      const next = pickDatabase(list, preferred);
      if (next) {
        setActiveDatabase(next);
        setExpandedDatabases(new Set([next]));
        await loadTablesFor(connectionId, next);
      }
    } catch (error) {
      if (request !== dbRequest.current || activeIdRef.current !== connectionId) return;
      setTreeError(errText(error));
    } finally {
      if (request === dbRequest.current) setLoadingDatabases(false);
    }
  };

  const connect = async (config: DbConfig) => {
    if (connectingId) return;
    setConnectingId(config.id);
    try {
      const next = await dbConnect(config);
      if (active && active.id !== config.id) {
        await dbDisconnect(active.id).catch(() => undefined);
      }
      activeIdRef.current = config.id;
      setActive(config);
      setInfo(next);
      setConnectionExpanded(true);
      setTableFilter("");
      clearTabs();
      markUsed(config.id);
      message.success(t("db.connected"));
      void loadDatabases(config.id, next.database ?? config.database ?? null);
    } catch (error) {
      message.error(errText(error));
    } finally {
      setConnectingId(null);
    }
  };

  const disconnect = async () => {
    if (!active) return;
    await dbDisconnect(active.id).catch(() => undefined);
    activeIdRef.current = null;
    setActive(null);
    setInfo(null);
    setDatabases([]);
    setExpandedDatabases(new Set());
    setTablesByDb({});
    setActiveDatabase(null);
    setConnectionExpanded(true);
    clearTabs();
    message.success(t("db.disconnected"));
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (config: DbConfig) => {
    setEditing(config);
    setFormOpen(true);
  };

  const deleteConnection = (config: DbConfig) => {
    modal.confirm({
      title: t("db.deleteConnection"),
      content: t("db.deleteConnectionConfirm", {
        name: config.name || `${config.host}:${config.port}`,
      }),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          if (active?.id === config.id) {
            await dbDisconnect(config.id).catch(() => undefined);
            activeIdRef.current = null;
            setActive(null);
            setInfo(null);
            setDatabases([]);
            setExpandedDatabases(new Set());
            setTablesByDb({});
            setActiveDatabase(null);
            clearTabs();
          }
          await useDbStore.getState().remove(config.id);
          message.success(t("common.delete"));
        } catch (error) {
          message.error(errText(error));
        }
      },
    });
  };

  const toggleConnection = (config: DbConfig) => {
    if (active?.id === config.id) {
      setConnectionExpanded((value) => !value);
    } else {
      void connect(config);
    }
  };

  const toggleDatabase = (database: string) => {
    if (!active) return;
    setActiveDatabase(database);
    if (expandedDatabases.has(database)) {
      setExpandedDatabases((prev) => {
        const next = new Set(prev);
        next.delete(database);
        return next;
      });
      return;
    }
    setExpandedDatabases((prev) => new Set(prev).add(database));
    if (tablesByDb[database] === undefined) {
      void loadTablesFor(active.id, database);
    }
  };

  const openTable = (database: string, table: string) => {
    const key = `${database}.${table}`;
    setTableTabs((prev) =>
      prev.some((tab) => tab.key === key)
        ? prev
        : [...prev, { key, database, table, view: "data" }],
    );
    setActiveTabKey(key);
    setActiveDatabase(database);
  };

  const closeTableTab = (key: string) => {
    const index = tableTabs.findIndex((tab) => tab.key === key);
    if (index < 0) return;
    const next = tableTabs.filter((tab) => tab.key !== key);
    setTableTabs(next);
    if (activeTabKey === key) {
      const fallback = next[index - 1] ?? next[index] ?? null;
      setActiveTabKey(fallback?.key ?? "sql");
      if (fallback) setActiveDatabase(fallback.database);
    }
  };

  const setTabView = (
    key: string,
    view: "data" | "structure" | "index" | "settings" | "ddl",
  ) => {
    setTableTabs((prev) =>
      prev.map((tab) => (tab.key === key ? { ...tab, view } : tab)),
    );
  };

  const tableKey = (database: string, table: string) => `${database}.${table}`;

  const renameTableTab = (database: string, oldTable: string, newTable: string) => {
    const oldKey = tableKey(database, oldTable);
    const newKey = tableKey(database, newTable);
    setTableTabs((previous) =>
      previous.map((tab) =>
        tab.key === oldKey ? { ...tab, key: newKey, table: newTable } : tab,
      ),
    );
    setActiveTabKey((current) => (current === oldKey ? newKey : current));
    if (active) void loadTablesFor(active.id, database);
  };

  const reloadAfterTableChange = (database: string) => {
    if (!active) return;
    void loadTablesFor(active.id, database);
    setActiveDatabase(database);
    setExpandedDatabases((prev) => new Set(prev).add(database));
  };

  const truncateTable = (target: { database: string; table: string }) => {
    setTableMenu(null);
    if (!active) return;
    modal.confirm({
      title: t("db.truncateTable"),
      content: t("db.truncateConfirm", { table: target.table }),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await dbExecDdl(
            active.id,
            `TRUNCATE TABLE ${qualified(target.database, target.table)}`,
          );
          closeTableTab(tableKey(target.database, target.table));
          message.success(t("db.tableTruncated"));
          reloadAfterTableChange(target.database);
        } catch (reason) {
          message.error(errText(reason));
        }
      },
    });
  };

  const dropTable = (target: { database: string; table: string }) => {
    setTableMenu(null);
    if (!active) return;
    modal.confirm({
      title: t("db.dropTable"),
      content: t("db.dropTableConfirm", { table: target.table }),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await dbExecDdl(
            active.id,
            `DROP TABLE ${qualified(target.database, target.table)}`,
          );
          closeTableTab(tableKey(target.database, target.table));
          message.success(t("db.tableDropped"));
          reloadAfterTableChange(target.database);
        } catch (reason) {
          message.error(errText(reason));
        }
      },
    });
  };

  const openTableMenu = (
    event: React.MouseEvent,
    database: string,
    table: string,
  ) => {
    event.preventDefault();
    setTableMenu({ x: event.clientX, y: event.clientY, database, table });
  };

  const handleTableCreated = (database: string, table: string) => {
    reloadAfterTableChange(database);
    openTable(database, table);
  };

  const refreshTree = () => {
    if (!active) return;
    void loadDatabases(active.id, activeDatabase);
  };

  const activeTableTab = tableTabs.find((tab) => tab.key === activeTabKey) ?? null;
  const effectiveTabKey = activeTableTab ? activeTabKey : "sql";
  const selection = activeTableTab
    ? { database: activeTableTab.database, table: activeTableTab.table }
    : null;

  return (
    <div className="module db-module">
      <header className="module-head">
        <span className="module-icon">
          <DatabaseIcon />
        </span>
        <div>
          <Typography.Text strong style={{ fontSize: 14 }}>
            {t("module.db")}
          </Typography.Text>
          <div className="module-desc">{t("module.dbDesc")}</div>
        </div>
        <span style={{ flex: 1 }} />
        {active && info && (
          <div className="db-head-status">
            <span className="db-status-dot" />
            <span className="db-head-name" title={active.name || active.host}>
              {active.name || `${active.host}:${active.port}`}
            </span>
            <span className="db-head-ver">MySQL {info.version}</span>
            <span className="db-head-server">{info.server}</span>
            <Button size="small" icon={<DisconnectOutlined />} onClick={() => void disconnect()}>
              {t("db.disconnect")}
            </Button>
          </div>
        )}
      </header>

      <div className="db-body">
        <aside className="db-side">
          <Button block icon={<PlusOutlined />} onClick={openCreate}>
            {t("db.newConnection")}
          </Button>

          <DbTree
            connections={connections}
            activeId={active?.id ?? null}
            connectingId={connectingId}
            databases={databases}
            activeDatabase={activeDatabase}
            expandedDatabases={expandedDatabases}
            tablesByDb={tablesByDb}
            selection={selection}
            filter={tableFilter}
            connectionExpanded={connectionExpanded}
            loadingDatabases={loadingDatabases}
            loadingTables={loadingTableDbs}
            error={treeError}
            onToggleConnection={toggleConnection}
            onToggleDatabase={toggleDatabase}
            onFilterChange={setTableFilter}
            onSelectTable={openTable}
            onTableContextMenu={openTableMenu}
            onCreateTable={() => setNewTableOpen(true)}
            onRefresh={refreshTree}
            onEdit={openEdit}
            onDelete={deleteConnection}
          />
        </aside>

        <section className="db-main">
          {active ? (
            <>
              <div className="db-tabs-bar">
                <button
                  type="button"
                  className={`db-tab db-tab-sql${effectiveTabKey === "sql" ? " active" : ""}`}
                  onClick={() => setActiveTabKey("sql")}
                >
                  <ConsoleSqlOutlined />
                  <span>{t("db.sql")}</span>
                </button>

                {tableTabs.map((tab) => (
                  <div
                    key={tab.key}
                    className={`db-tab${effectiveTabKey === tab.key ? " active" : ""}`}
                    onClick={() => {
                      setActiveTabKey(tab.key);
                      setActiveDatabase(tab.database);
                    }}
                    title={`${tab.table} (${tab.database})`}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setActiveTabKey(tab.key);
                        setActiveDatabase(tab.database);
                      }
                    }}
                  >
                    <span className="db-tab-label">
                      <span className="db-tab-table">{tab.table}</span>
                      <span className="db-tab-db-wrap">
                        <span className="db-tab-db-open">(</span>
                        <span className="db-tab-db" title={tab.database}>
                          {tab.database}
                        </span>
                        <span className="db-tab-db-close">)</span>
                      </span>
                    </span>
                    <button
                      type="button"
                      className="db-tab-close"
                      title={t("common.close")}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTableTab(tab.key);
                      }}
                    >
                      <CloseOutlined />
                    </button>
                  </div>
                ))}
              </div>

              <div className="db-tab-content">
                {tableTabs.map((tab) => (
                  <div
                    key={tab.key}
                    className="db-slot"
                    style={{ display: effectiveTabKey === tab.key ? "flex" : "none" }}
                  >
                    <DbTableTab
                      connectionId={active.id}
                      database={tab.database}
                      table={tab.table}
                      view={tab.view}
                      onViewChange={(view) => setTabView(tab.key, view)}
                      onTableRenamed={(newName) =>
                        renameTableTab(tab.database, tab.table, newName)
                      }
                    />
                  </div>
                ))}

                <div
                  className="db-slot"
                  style={{ display: effectiveTabKey === "sql" ? "flex" : "none" }}
                >
                  <DbSqlView
                    key={active.id}
                    connectionId={active.id}
                    database={activeDatabase}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="db-welcome db-welcome-main">
              <span className="db-welcome-icon">
                <DatabaseIcon />
              </span>
              <div className="db-welcome-title">{t("db.selectConnection")}</div>
              <div className="db-hint">{t("db.emptyConnections")}</div>
              <Button icon={<PlusOutlined />} onClick={openCreate}>
                {t("db.newConnection")}
              </Button>
            </div>
          )}
        </section>
      </div>

      {tableMenu && (
        <div
          className="db-context-menu"
          style={{ left: tableMenu.x, top: tableMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => truncateTable(tableMenu)}
          >
            <ClearOutlined />
            {t("db.truncateTable")}
          </button>
          <button
            type="button"
            onClick={() => dropTable(tableMenu)}
          >
            <DeleteOutlined />
            {t("db.dropTable")}
          </button>
          <button
            type="button"
            onClick={() => {
              setTableMenu(null);
              setCloneTarget({
                database: tableMenu.database,
                table: tableMenu.table,
                withData: false,
              });
            }}
          >
            <CopyOutlined />
            {t("db.copyStructure")}
          </button>
          <button
            type="button"
            onClick={() => {
              setTableMenu(null);
              setCloneTarget({
                database: tableMenu.database,
                table: tableMenu.table,
                withData: true,
              });
            }}
          >
            <CopyOutlined />
            {t("db.copyStructureData")}
          </button>
        </div>
      )}

      <DbNewTableModal
        open={newTableOpen}
        connectionId={active?.id ?? ""}
        database={activeDatabase ?? ""}
        onClose={() => setNewTableOpen(false)}
        onCreated={(table) => {
          if (activeDatabase) handleTableCreated(activeDatabase, table);
        }}
      />

      <DbCloneTableModal
        open={cloneTarget !== null}
        connectionId={active?.id ?? ""}
        database={cloneTarget?.database ?? ""}
        sourceTable={cloneTarget?.table ?? ""}
        withData={cloneTarget?.withData ?? false}
        onClose={() => setCloneTarget(null)}
        onCreated={(table) => {
          if (cloneTarget) handleTableCreated(cloneTarget.database, table);
        }}
      />

      <DbForm
        open={formOpen}
        initial={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(config) => {
          setEditing(null);
          void connect(config);
        }}
      />
    </div>
  );
}
