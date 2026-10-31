import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { App as AntdApp, Button, Input } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useDbStore } from "../../stores/dbStore";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import { copyText } from "../../clipboard";
import DbForm from "./DbForm";
import DbTree from "./DbTree";
import { connectionColor } from "./colors";
import { DatabaseIcon } from "./icons";
import DbNewTableModal from "./DbNewTableModal";
import DbNewQueryModal from "./DbNewQueryModal";
import { createQueryDef, type DbQueryDef } from "./queries";
import type { DbConfig } from "./api";
import {
  MAX_SIDE_WIDTH,
  MIN_SIDE_WIDTH,
  type DatabaseMenuState,
  type QueryMenuState,
  type TableMenuState,
  type TableTarget,
  type TabMenuState,
} from "./dbModuleTypes";
import useDbQueries from "./useDbQueries";
import useDbCatalog from "./useDbCatalog";
import useDbTabs from "./useDbTabs";
import useDbSession from "./useDbSession";
import useDbTableActions from "./useDbTableActions";
import DbModuleHeader from "./DbModuleHeader";
import DbTabsBar from "./DbTabsBar";
import DbTabContent from "./DbTabContent";
import {
  DbDatabaseMenu,
  DbQueryMenu,
  DbTabMenu,
  DbTableMenu,
} from "./DbContextMenus";

export default function DbModule() {
  const t = useT(useUiStore((state) => state.lang));
  const { message, modal } = AntdApp.useApp();
  const connections = useDbStore((state) => state.connections);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DbConfig | null>(null);
  const [newTableDatabase, setNewTableDatabase] = useState<string | null>(null);
  const [newQueryDatabase, setNewQueryDatabase] = useState<string | null>(null);
  const [tableMenu, setTableMenu] = useState<TableMenuState | null>(null);
  const [databaseMenu, setDatabaseMenu] = useState<DatabaseMenuState | null>(null);
  const [queryMenu, setQueryMenu] = useState<QueryMenuState | null>(null);
  const [tabMenu, setTabMenu] = useState<TabMenuState | null>(null);

  const sideWidth = useUiStore((state) => state.sideWidth);
  const setSideWidth = useUiStore((state) => state.setSideWidth);
  const activeIdRef = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const queries = useDbQueries();
  const catalog = useDbCatalog(activeIdRef);
  const reloadTablesFor = (database: string) => {
    const id = activeIdRef.current;
    if (id) void catalog.loadTablesFor(id, database);
  };
  const tabs = useDbTabs(queries.queryDefs, {
    setActiveDatabase: catalog.setActiveDatabase,
    expandDatabase: catalog.expandDatabase,
    reloadTablesFor,
  });
  const session = useDbSession({
    t,
    activeIdRef,
    clearTabs: tabs.clearTabs,
    resetCatalog: catalog.resetCatalog,
    loadDatabases: catalog.loadDatabases,
    activeDatabase: catalog.activeDatabase,
  });
  const active = session.active;
  const info = session.info;

  const reloadAfterTableChange = (database: string) => {
    if (!active) return;
    void catalog.loadTablesFor(active.id, database);
    catalog.setActiveDatabase(database);
    catalog.expandDatabase(database);
  };

  const tableActions = useDbTableActions({
    t,
    activeId: active?.id ?? null,
    closeTab: tabs.closeTab,
    renameTableTab: tabs.renameTableTab,
    reloadAfterTableChange,
    closeTableMenu: () => setTableMenu(null),
  });

  /** 拖动左右分栏之间的分隔条调整左侧宽度 */
  const startSideResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sideWidth;
    const containerWidth = bodyRef.current?.clientWidth ?? 960;
    const maxWidth = Math.max(
      MIN_SIDE_WIDTH,
      Math.min(MAX_SIDE_WIDTH, containerWidth - 360),
    );
    document.body.classList.add("db-resizing");
    const onMove = (moveEvent: MouseEvent) => {
      const next = startWidth + (moveEvent.clientX - startX);
      setSideWidth(Math.min(maxWidth, Math.max(MIN_SIDE_WIDTH, next)));
    };
    const onUp = () => {
      document.body.classList.remove("db-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    if (!tableMenu && !databaseMenu && !queryMenu && !tabMenu) return;
    const close = () => {
      setTableMenu(null);
      setDatabaseMenu(null);
      setQueryMenu(null);
      setTabMenu(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [tableMenu, databaseMenu, queryMenu, tabMenu]);

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
            await session.resetConnectionState(config.id);
          }
          await useDbStore.getState().remove(config.id);
          message.success(t("common.delete"));
        } catch (error) {
          message.error(errText(error));
        }
      },
    });
  };

  const createQuery = (database: string, name: string) => {
    if (!active) return;
    const query = createQueryDef(active.id, database, name);
    queries.addQuery(query);
    tabs.openQuery(query);
  };

  const renameQuery = (query: DbQueryDef, name: string) => {
    queries.renameQuery(query, name);
    message.success(t("db.queryRenamed"));
  };

  const promptRenameQuery = (query: DbQueryDef) => {
    let nextName = query.name;
    modal.confirm({
      title: t("db.renameQuery"),
      content: (
        <Input
          autoFocus
          defaultValue={query.name}
          placeholder={t("db.queryNamePlaceholder")}
          onChange={(event) => {
            nextName = event.target.value;
          }}
        />
      ),
      okText: t("common.save"),
      cancelText: t("common.cancel"),
      onOk: () => {
        const value = nextName.trim();
        if (!value) {
          message.warning(t("db.queryNameRequired"));
          return;
        }
        renameQuery(query, value);
      },
    });
  };

  const deleteQuery = (query: DbQueryDef) => {
    modal.confirm({
      title: t("db.deleteQuery"),
      content: t("db.deleteQueryConfirm", { name: query.name }),
      okText: t("common.delete"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: () => {
        if (tabs.openQueryIds.includes(query.id)) tabs.closeTab(`q:${query.id}`);
        queries.removeQuery(query.id);
        message.success(t("db.queryDeleted"));
      },
    });
  };

  const renameQueryFromMenu = (query: DbQueryDef) => {
    setQueryMenu(null);
    promptRenameQuery(query);
  };

  const deleteQueryFromMenu = (query: DbQueryDef) => {
    setQueryMenu(null);
    deleteQuery(query);
  };

  const copyTableNameFromMenu = (table: string) => {
    setTableMenu(null);
    void copyText(table).then(
      () => message.success(t("db.tableNameCopied")),
      () => message.error(t("common.copyFailed")),
    );
  };

  const renameTableFromMenu = (target: TableTarget) => {
    setTableMenu(null);
    tableActions.promptRenameTable(target);
  };

  const copyTableStructureFromMenu = (target: TableTarget) => {
    setTableMenu(null);
    void tableActions.copyTableStructure(target.database, target.table);
  };

  const exportTableSqlFromMenu = (target: TableTarget) => {
    setTableMenu(null);
    void tableActions.exportTableSql(target.database, target.table);
  };

  const openNewTable = (database: string) => {
    setTableMenu(null);
    setDatabaseMenu(null);
    setNewTableDatabase(database);
  };

  const openNewQuery = (database: string) => {
    setTableMenu(null);
    setDatabaseMenu(null);
    setNewQueryDatabase(database);
  };

  const closeDatabase = (database: string) => {
    setDatabaseMenu(null);
    tabs.closeDatabaseTabs(database);
    catalog.forgetDatabase(database);
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
    setQueryMenu(null);
    setDatabaseMenu({ x: event.clientX, y: event.clientY, database });
  };

  const openQueryMenu = (event: React.MouseEvent, query: DbQueryDef) => {
    event.preventDefault();
    setTableMenu(null);
    setDatabaseMenu(null);
    setQueryMenu({ x: event.clientX, y: event.clientY, query });
  };

  const openTabMenu = (key: string, x: number, y: number) => {
    setTableMenu(null);
    setDatabaseMenu(null);
    setQueryMenu(null);
    setTabMenu({ x, y, key });
  };

  const handleTableCreated = (database: string, table: string) => {
    reloadAfterTableChange(database);
    tabs.openTable(database, table);
  };

  const closeTabFromMenu = (key: string) => {
    setTabMenu(null);
    tabs.closeTab(key);
  };

  const closeOtherTabs = (key: string) => {
    setTabMenu(null);
    tabs.closeTabsByKeys(
      tabs.tabOrder.filter((item) => item !== key),
      key,
    );
  };

  const closeTabsLeft = (key: string) => {
    setTabMenu(null);
    tabs.closeTabsByKeys(tabs.tabOrder.slice(0, tabs.tabOrder.indexOf(key)), key);
  };

  const closeTabsRight = (key: string) => {
    setTabMenu(null);
    tabs.closeTabsByKeys(tabs.tabOrder.slice(tabs.tabOrder.indexOf(key) + 1), key);
  };

  const dbQueries = active
    ? queries.queryDefs.filter((query) => query.connectionId === active.id)
    : [];
  const activeConnectionColor = connectionColor(active?.color);

  return (
    <div
      className="module db-module"
      style={{ "--db-conn-color": activeConnectionColor } as CSSProperties}
    >
      <DbModuleHeader
        active={active}
        info={info}
        onDisconnect={() => void session.disconnect()}
      />

      <div className="db-body" ref={bodyRef}>
        <aside className="db-side" style={{ width: sideWidth }}>
          <Button block icon={<PlusOutlined />} onClick={openCreate}>
            {t("db.newConnection")}
          </Button>

          <DbTree
            connections={connections}
            activeId={active?.id ?? null}
            connectingId={session.connectingId}
            databases={catalog.databases}
            activeDatabase={catalog.activeDatabase}
            expandedDatabases={catalog.expandedDatabases}
            tablesByDb={catalog.tablesByDb}
            selection={tabs.selection}
            queries={dbQueries}
            activeQueryId={tabs.activeQueryId}
            filter={session.tableFilter}
            connectionExpanded={session.connectionExpanded}
            loadingDatabases={catalog.loadingDatabases}
            loadingTables={catalog.loadingTableDbs}
            error={catalog.treeError}
            onToggleConnection={session.toggleConnection}
            onToggleDatabase={catalog.toggleDatabase}
            onFilterChange={session.setTableFilter}
            onSelectTable={tabs.openTable}
            onSelectQuery={tabs.openQuery}
            onQueryContextMenu={openQueryMenu}
            onTableContextMenu={openTableMenu}
            onDatabaseContextMenu={openDatabaseMenu}
            onRefresh={session.refreshTree}
            onEdit={openEdit}
            onDelete={deleteConnection}
            onDisconnect={(config) => {
              if (active?.id === config.id) void session.disconnect();
            }}
          />
        </aside>

        <div className="db-side-resizer" onMouseDown={startSideResize} />

        <section className="db-main">
          {active ? (
            tabs.tabCount === 0 ? (
              <div className="db-welcome db-welcome-main">
                <span className="db-welcome-icon">
                  <DatabaseIcon />
                </span>
                <div className="db-welcome-title">{t("db.noOpenTabs")}</div>
                <div className="db-hint">{t("db.openTabsHint")}</div>
              </div>
            ) : (
              <>
                <DbTabsBar
                  tableTabs={tabs.tableTabs}
                  openQueries={tabs.openQueries}
                  effectiveTabKey={tabs.effectiveTabKey}
                  duplicatedTableNames={tabs.duplicatedTableNames}
                  onSelectTableTab={tabs.activateTableTab}
                  onSelectQuery={tabs.openQuery}
                  onCloseTab={tabs.closeTab}
                  onTabContextMenu={openTabMenu}
                />

                <DbTabContent
                  connectionId={active.id}
                  tableTabs={tabs.tableTabs}
                  openQueries={tabs.openQueries}
                  effectiveTabKey={tabs.effectiveTabKey}
                  onViewChange={tabs.setTabView}
                  onTableRenamed={tabs.renameTableTab}
                  onSqlChange={queries.updateQuerySql}
                />
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
        <DbTableMenu
          menu={tableMenu}
          onCopyName={copyTableNameFromMenu}
          onRename={renameTableFromMenu}
          onNewTable={openNewTable}
          onNewQuery={openNewQuery}
          onTruncate={tableActions.truncateTable}
          onDrop={tableActions.dropTable}
          onCopyStructure={copyTableStructureFromMenu}
          onExport={exportTableSqlFromMenu}
        />
      )}

      {databaseMenu && (
        <DbDatabaseMenu
          menu={databaseMenu}
          onNewTable={openNewTable}
          onNewQuery={openNewQuery}
          onCloseDatabase={closeDatabase}
        />
      )}

      {queryMenu && (
        <DbQueryMenu
          menu={queryMenu}
          onRename={renameQueryFromMenu}
          onDelete={deleteQueryFromMenu}
        />
      )}

      {tabMenu && (
        <DbTabMenu
          menu={tabMenu}
          tabOrder={tabs.tabOrder}
          onCloseTab={closeTabFromMenu}
          onCloseOtherTabs={closeOtherTabs}
          onCloseTabsLeft={closeTabsLeft}
          onCloseTabsRight={closeTabsRight}
        />
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
          // 新建连接保存后直接连接；修改连接只保存配置，不再自动重连，
          // 否则数据库暂时不可达时会直接弹 Connection refused。
          const wasEditing = editing !== null;
          setEditing(null);
          if (!wasEditing) {
            void session.connect(config);
            return;
          }
          const current = active;
          if (!current || current.id !== config.id) return;
          const targetChanged =
            current.host !== config.host ||
            current.port !== config.port ||
            (current.username ?? "") !== (config.username ?? "") ||
            (current.password ?? "") !== (config.password ?? "") ||
            (current.database ?? "") !== (config.database ?? "");
          if (!targetChanged) {
            // 只改了名字/颜色等展示信息，连接可以继续用
            session.setActiveConfig(config);
            return;
          }
          void session.resetConnectionState(config.id).then(() => {
            message.info(t("db.reconnectHint"));
          });
        }}
      />
    </div>
  );
}
