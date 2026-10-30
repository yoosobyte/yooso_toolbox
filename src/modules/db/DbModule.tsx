import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { App as AntdApp, Button, Typography } from "antd";
import {
  ClearOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  DownloadOutlined,
  FileTextOutlined,
  PlusOutlined,
  TableOutlined,
} from "@ant-design/icons";
import { useDbStore } from "../../stores/dbStore";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import DbForm from "./DbForm";
import DbTree from "./DbTree";
import { DatabaseIcon } from "./icons";
import { copyText } from "../../clipboard";
import { saveText } from "../../save";
import DbTableTab from "./DbTableTab";
import DbSqlView from "./DbSqlView";
import DbNewTableModal from "./DbNewTableModal";
import DbNewQueryModal from "./DbNewQueryModal";
import {
  dbConnect,
  dbDatabases,
  dbDisconnect,
  dbExecDdl,
  dbQuery,
  dbTableDdl,
  dbTables,
  type DbConfig,
  type DbConnectInfo,
  type DbTableInfo,
} from "./api";
import { escapeSqlString, qualified, quoteIdent } from "./ddl";
import {
  createQueryDef,
  loadQueries,
  saveQueries,
  type DbQueryDef,
} from "./queries";

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
  const [queryDefs, setQueryDefs] = useState<DbQueryDef[]>(() => loadQueries());
  const [openQueryIds, setOpenQueryIds] = useState<string[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState("");
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [loadingTableDbs, setLoadingTableDbs] = useState<Set<string>>(new Set());
  const [treeError, setTreeError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DbConfig | null>(null);
  const [newTableDatabase, setNewTableDatabase] = useState<string | null>(null);
  const [newQueryDatabase, setNewQueryDatabase] = useState<string | null>(null);
  const [tableMenu, setTableMenu] = useState<{
    x: number;
    y: number;
    database: string;
    table: string;
  } | null>(null);
  const [databaseMenu, setDatabaseMenu] = useState<{
    x: number;
    y: number;
    database: string;
  } | null>(null);

  const dbRequest = useRef(0);
  const activeIdRef = useRef<string | null>(null);
  const tabsBarRef = useRef<HTMLDivElement | null>(null);
  const tabDragRef = useRef<{
    startX: number;
    startScroll: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);
  const suppressTabClickRef = useRef(false);
  const openQueries = openQueryIds
    .map((id) => queryDefs.find((query) => query.id === id))
    .filter((query): query is DbQueryDef => Boolean(query));

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!tableMenu && !databaseMenu) return;
    const close = () => {
      setTableMenu(null);
      setDatabaseMenu(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [tableMenu, databaseMenu]);

  const clearTabs = () => {
    setTableTabs([]);
    setOpenQueryIds([]);
    setActiveTabKey(null);
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

  const copyTableStructure = async (database: string, table: string) => {
    if (!active) return;
    try {
      const ddl = await dbTableDdl(active.id, database, table);
      await copyText(ddl);
      message.success(t("db.structureCopied"));
    } catch (error) {
      message.error(errText(error));
    }
  };

  const exportTableSql = async (database: string, table: string) => {
    if (!active) return;
    try {
      const ddl = await dbTableDdl(active.id, database, table);
      const result = await dbQuery(
        active.id,
        database,
        `SELECT * FROM ${qualified(database, table)}`,
      );
      const lines = [
        "-- Yooso Toolbox SQL export",
        `-- ${qualified(database, table)}`,
        "SET NAMES utf8mb4;",
        "SET FOREIGN_KEY_CHECKS=0;",
        "",
        `${ddl.trim().replace(/;?$/, "")};`,
      ];
      if (result.rows.length > 0) {
        const columns = result.columns.map((column) => quoteIdent(column.name)).join(", ");
        const values = result.rows.map(
          (row) =>
            `(${row
              .map((value) =>
                value === null ? "NULL" : `'${escapeSqlString(value)}'`,
              )
              .join(", ")})`,
        );
        lines.push(
          "",
          `INSERT INTO ${qualified(database, table)} (${columns}) VALUES`,
          `${values.join(",\n")};`,
        );
      }
      lines.push("", "SET FOREIGN_KEY_CHECKS=1;");
      const filename = `${database}.${table}.sql`.replace(/[\\/:*?"<>|]/g, "_");
      const path = await saveText(
        filename,
        lines.join("\n"),
        [{ name: "SQL", extensions: ["sql"] }],
        "application/sql",
      );
      if (path) message.success(t("db.sqlSaved", { path }));
    } catch (error) {
      message.error(errText(error));
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

  const openQuery = (query: DbQueryDef) => {
    setOpenQueryIds((prev) =>
      prev.includes(query.id) ? prev : [...prev, query.id],
    );
    setActiveTabKey(`q:${query.id}`);
    setActiveDatabase(query.database);
    setExpandedDatabases((prev) => new Set(prev).add(query.database));
  };

  const createQuery = (database: string, name: string) => {
    if (!active) return;
    const query = createQueryDef(active.id, database, name);
    const next = [...queryDefs, query];
    setQueryDefs(next);
    saveQueries(next);
    setOpenQueryIds((prev) => [...prev, query.id]);
    setActiveTabKey(`q:${query.id}`);
    setActiveDatabase(database);
    setExpandedDatabases((prev) => new Set(prev).add(database));
  };

  const updateQuerySql = (id: string, sql: string) => {
    setQueryDefs((previous) => {
      const next = previous.map((query) =>
        query.id === id ? { ...query, sql } : query,
      );
      saveQueries(next);
      return next;
    });
  };

  const closeTab = (key: string) => {
    const keys = [
      ...tableTabs.map((tab) => tab.key),
      ...openQueries.map((query) => `q:${query.id}`),
    ];
    const index = keys.indexOf(key);
    if (index < 0) return;
    const fallback = keys[index - 1] ?? keys[index + 1] ?? null;

    if (key.startsWith("q:")) {
      const id = key.slice(2);
      setOpenQueryIds((prev) => prev.filter((queryId) => queryId !== id));
    } else {
      setTableTabs((prev) => prev.filter((tab) => tab.key !== key));
    }

    if (activeTabKey === key) {
      setActiveTabKey(fallback);
      if (fallback) {
        const table = tableTabs.find((tab) => tab.key === fallback);
        if (table) setActiveDatabase(table.database);
        else {
          const query = openQueries.find(
            (item) => `q:${item.id}` === fallback,
          );
          if (query) setActiveDatabase(query.database);
        }
      }
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
          closeTab(tableKey(target.database, target.table));
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
          closeTab(tableKey(target.database, target.table));
          message.success(t("db.tableDropped"));
          reloadAfterTableChange(target.database);
        } catch (reason) {
          message.error(errText(reason));
        }
      },
    });
  };

  const openNewTable = (database: string) => {
    setTableMenu(null);
    setDatabaseMenu(null);
    setNewTableDatabase(database);
  };

  const openTableMenu = (
    event: React.MouseEvent,
    database: string,
    table: string,
  ) => {
    event.preventDefault();
    setDatabaseMenu(null);
    setTableMenu({ x: event.clientX, y: event.clientY, database, table });
  };

  const openDatabaseMenu = (event: React.MouseEvent, database: string) => {
    event.preventDefault();
    setTableMenu(null);
    setDatabaseMenu({ x: event.clientX, y: event.clientY, database });
  };

  const handleTableCreated = (database: string, table: string) => {
    reloadAfterTableChange(database);
    openTable(database, table);
  };

  const refreshTree = () => {
    if (!active) return;
    void loadDatabases(active.id, activeDatabase);
  };

  const onTabsPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const bar = tabsBarRef.current;
    if (!bar) return;
    suppressTabClickRef.current = false;
    tabDragRef.current = {
      startX: event.clientX,
      startScroll: bar.scrollLeft,
      moved: false,
      pointerId: event.pointerId,
    };
  };

  const onTabsPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = tabDragRef.current;
    const bar = tabsBarRef.current;
    if (!drag || !bar) return;
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 4 && !drag.moved) {
      drag.moved = true;
      bar.setPointerCapture(drag.pointerId);
    }
    if (drag.moved) {
      event.preventDefault();
      bar.scrollLeft = drag.startScroll - delta;
    }
  };

  const onTabsPointerUp = () => {
    const drag = tabDragRef.current;
    const bar = tabsBarRef.current;
    if (!drag) return;
    if (drag.moved) suppressTabClickRef.current = true;
    try {
      bar?.releasePointerCapture(drag.pointerId);
    } catch {
      // pointer capture may already be released
    }
    tabDragRef.current = null;
  };

  const onTabsClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressTabClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressTabClickRef.current = false;
  };

  const activeTableTab = tableTabs.find((tab) => tab.key === activeTabKey) ?? null;
  const activeQueryTab =
    openQueries.find((query) => `q:${query.id}` === activeTabKey) ?? null;
  const effectiveTabKey = activeTableTab
    ? activeTabKey
    : activeQueryTab
      ? activeTabKey
      : null;
  const activeQueryId = activeQueryTab?.id ?? null;
  const dbQueries = active
    ? queryDefs.filter((query) => query.connectionId === active.id)
    : [];
  const tabCount = tableTabs.length + openQueries.length;
  const selection = activeTableTab
    ? { database: activeTableTab.database, table: activeTableTab.table }
    : null;
  const connectionColor =
    active?.color && /^#[0-9a-f]{6}$/i.test(active.color)
      ? active.color
      : "#3b82f6";
  const duplicatedTableNames = new Set(
    tableTabs
      .map((tab) => tab.table)
      .filter((name, index, all) => all.indexOf(name) !== index),
  );

  return (
    <div
      className="module db-module"
      style={{ "--db-conn-color": connectionColor } as CSSProperties}
    >
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
            queries={dbQueries}
            activeQueryId={activeQueryId}
            filter={tableFilter}
            connectionExpanded={connectionExpanded}
            loadingDatabases={loadingDatabases}
            loadingTables={loadingTableDbs}
            error={treeError}
            onToggleConnection={toggleConnection}
            onToggleDatabase={toggleDatabase}
            onFilterChange={setTableFilter}
            onSelectTable={openTable}
            onSelectQuery={openQuery}
            onTableContextMenu={openTableMenu}
            onDatabaseContextMenu={openDatabaseMenu}
            onCreateTable={() => {
              if (activeDatabase) openNewTable(activeDatabase);
            }}
            onRefresh={refreshTree}
            onEdit={openEdit}
            onDelete={deleteConnection}
          />
        </aside>

        <section className="db-main">
          {active ? (
            tabCount === 0 ? (
              <div className="db-welcome db-welcome-main">
                <span className="db-welcome-icon">
                  <FileTextOutlined />
                </span>
                <div className="db-welcome-title">{t("db.noOpenTabs")}</div>
                <div className="db-hint">{t("db.openTabsHint")}</div>
              </div>
            ) : (
              <>
                <div
                  className="db-tabs-bar"
                  ref={tabsBarRef}
                  onPointerDown={onTabsPointerDown}
                  onPointerMove={onTabsPointerMove}
                  onPointerUp={onTabsPointerUp}
                  onPointerCancel={onTabsPointerUp}
                  onClickCapture={onTabsClickCapture}
                >
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
                      <TableOutlined />
                      <span className="db-tab-label">
                        <span className="db-tab-table">{tab.table}</span>
                        {duplicatedTableNames.has(tab.table) && (
                          <span className="db-tab-db-wrap">
                            <span className="db-tab-db-open">(</span>
                            <span className="db-tab-db" title={tab.database}>
                              {tab.database}
                            </span>
                            <span className="db-tab-db-close">)</span>
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="db-tab-close"
                        title={t("common.close")}
                        onClick={(event) => {
                          event.stopPropagation();
                          closeTab(tab.key);
                        }}
                      >
                        <CloseOutlined />
                      </button>
                    </div>
                  ))}

                  {openQueries.map((query) => {
                    const key = `q:${query.id}`;
                    return (
                      <div
                        key={key}
                        className={`db-tab db-tab-query${effectiveTabKey === key ? " active" : ""}`}
                        onClick={() => openQuery(query)}
                        title={`${query.name} (${query.database})`}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openQuery(query);
                          }
                        }}
                      >
                        <FileTextOutlined />
                        <span className="db-tab-query-name">{query.name}</span>
                        <button
                          type="button"
                          className="db-tab-close"
                          title={t("common.close")}
                          onClick={(event) => {
                            event.stopPropagation();
                            closeTab(key);
                          }}
                        >
                          <CloseOutlined />
                        </button>
                      </div>
                    );
                  })}
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

                  {openQueries.map((query) => {
                    const key = `q:${query.id}`;
                    return (
                      <div
                        key={key}
                        className="db-slot"
                        style={{ display: effectiveTabKey === key ? "flex" : "none" }}
                      >
                        <DbSqlView
                          connectionId={active.id}
                          database={query.database}
                          initialSql={query.sql}
                          onSqlChange={(sql) => updateQuerySql(query.id, sql)}
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            )
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
            onClick={() => {
              const table = tableMenu.table;
              setTableMenu(null);
              void copyText(table).then(
                () => message.success(t("db.tableNameCopied")),
                () => message.error(t("common.copyFailed")),
              );
            }}
          >
            <CopyOutlined />
            {t("db.copyTableName")}
          </button>
          <button type="button" onClick={() => openNewTable(tableMenu.database)}>
            <PlusOutlined />
            {t("db.newTable")}
          </button>
          <button
            type="button"
            onClick={() => {
              setTableMenu(null);
              setNewQueryDatabase(tableMenu.database);
            }}
          >
            <FileTextOutlined />
            {t("db.newQuery")}
          </button>
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
              const target = tableMenu;
              setTableMenu(null);
              void copyTableStructure(target.database, target.table);
            }}
          >
            <CopyOutlined />
            {t("db.copyStructure")}
          </button>
          <button
            type="button"
            onClick={() => {
              const target = tableMenu;
              setTableMenu(null);
              void exportTableSql(target.database, target.table);
            }}
          >
            <DownloadOutlined />
            {t("db.copyStructureData")}
          </button>
        </div>
      )}

      {databaseMenu && (
        <div
          className="db-context-menu"
          style={{ left: databaseMenu.x, top: databaseMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => openNewTable(databaseMenu.database)}
          >
            <PlusOutlined />
            {t("db.newTable")}
          </button>
          <button
            type="button"
            onClick={() => {
              setDatabaseMenu(null);
              setNewQueryDatabase(databaseMenu.database);
            }}
          >
            <FileTextOutlined />
            {t("db.newQuery")}
          </button>
        </div>
      )}

      <DbNewQueryModal
        open={newQueryDatabase !== null}
        database={newQueryDatabase ?? ""}
        onClose={() => setNewQueryDatabase(null)}
        onCreate={(name) => {
          if (newQueryDatabase) createQuery(newQueryDatabase, name);
        }}
      />

      <DbNewTableModal
        open={newTableDatabase !== null}
        connectionId={active?.id ?? ""}
        database={newTableDatabase ?? ""}
        onClose={() => setNewTableDatabase(null)}
        onCreated={(table) => {
          if (newTableDatabase) handleTableCreated(newTableDatabase, table);
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
