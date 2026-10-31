import { useState } from "react";
import type { DbQueryDef } from "./queries";
import { tableKey, type DbTabView, type TableTab, type TableTarget } from "./dbModuleTypes";

interface Handlers {
  /** 切换左侧树上高亮的库 */
  setActiveDatabase: (database: string) => void;
  /** 在树上展开某个库 */
  expandDatabase: (database: string) => void;
  /** 表被重命名后重新拉取该库的表列表 */
  reloadTablesFor: (database: string) => void;
}

/**
 * 主区域的页签状态：表页签、SQL 查询页签、当前激活页签及关闭规则。
 * 库树数据与查询定义分别由 useDbCatalog / useDbQueries 提供。
 */
export default function useDbTabs(queryDefs: DbQueryDef[], handlers: Handlers) {
  const [tableTabs, setTableTabs] = useState<TableTab[]>([]);
  const [openQueryIds, setOpenQueryIds] = useState<string[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);

  const openQueries = openQueryIds
    .map((id) => queryDefs.find((query) => query.id === id))
    .filter((query): query is DbQueryDef => Boolean(query));

  const clearTabs = () => {
    setTableTabs([]);
    setOpenQueryIds([]);
    setActiveTabKey(null);
  };

  const openTable = (database: string, table: string) => {
    const key = tableKey(database, table);
    setTableTabs((prev) =>
      prev.some((tab) => tab.key === key)
        ? prev
        : [...prev, { key, database, table, view: "data" }],
    );
    setActiveTabKey(key);
    handlers.setActiveDatabase(database);
  };

  const openQuery = (query: DbQueryDef) => {
    setOpenQueryIds((prev) =>
      prev.includes(query.id) ? prev : [...prev, query.id],
    );
    setActiveTabKey(`q:${query.id}`);
    handlers.setActiveDatabase(query.database);
    handlers.expandDatabase(query.database);
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
        if (table) handlers.setActiveDatabase(table.database);
        else {
          const query = openQueries.find(
            (item) => `q:${item.id}` === fallback,
          );
          if (query) handlers.setActiveDatabase(query.database);
        }
      }
    }
  };

  /** 批量关闭 tab；keep 在活动 tab 被关时接替显示 */
  const closeTabsByKeys = (keys: string[], keep: string) => {
    const removed = new Set(keys);
    if (removed.size === 0) return;
    setTableTabs((prev) => prev.filter((tab) => !removed.has(tab.key)));
    setOpenQueryIds((prev) => prev.filter((id) => !removed.has(`q:${id}`)));
    setActiveTabKey((current) => {
      if (current && !removed.has(current)) return current;
      return keep;
    });
    const table = tableTabs.find((tab) => tab.key === keep);
    if (table) handlers.setActiveDatabase(table.database);
    else {
      const query = openQueries.find((item) => `q:${item.id}` === keep);
      if (query) handlers.setActiveDatabase(query.database);
    }
  };

  const setTabView = (key: string, view: DbTabView) => {
    setTableTabs((prev) =>
      prev.map((tab) => (tab.key === key ? { ...tab, view } : tab)),
    );
  };

  const renameTableTab = (database: string, oldTable: string, newTable: string) => {
    const oldKey = tableKey(database, oldTable);
    const newKey = tableKey(database, newTable);
    setTableTabs((previous) =>
      previous.map((tab) =>
        tab.key === oldKey ? { ...tab, key: newKey, table: newTable } : tab,
      ),
    );
    setActiveTabKey((current) => (current === oldKey ? newKey : current));
    handlers.reloadTablesFor(database);
  };

  const activateTableTab = (tab: TableTab) => {
    setActiveTabKey(tab.key);
    handlers.setActiveDatabase(tab.database);
  };

  /** 关闭某个库时，一并关掉它名下的表页签与查询页签 */
  const closeDatabaseTabs = (database: string) => {
    const closingQueryIds = new Set(
      queryDefs
        .filter((query) => query.database === database)
        .map((query) => query.id),
    );
    const closingTabKeys = new Set(
      tableTabs.filter((tab) => tab.database === database).map((tab) => tab.key),
    );

    setTableTabs((prev) => prev.filter((tab) => tab.database !== database));
    setOpenQueryIds((prev) => prev.filter((id) => !closingQueryIds.has(id)));
    setActiveTabKey((current) => {
      if (!current) return null;
      if (current.startsWith("q:")) {
        return closingQueryIds.has(current.slice(2)) ? null : current;
      }
      return closingTabKeys.has(current) ? null : current;
    });
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
  const tabOrder = [
    ...tableTabs.map((tab) => tab.key),
    ...openQueries.map((query) => `q:${query.id}`),
  ];
  const tabCount = tabOrder.length;
  const selection: TableTarget | null = activeTableTab
    ? { database: activeTableTab.database, table: activeTableTab.table }
    : null;
  const duplicatedTableNames = new Set(
    tableTabs
      .map((tab) => tab.table)
      .filter((name, index, all) => all.indexOf(name) !== index),
  );

  return {
    tableTabs,
    openQueryIds,
    openQueries,
    effectiveTabKey,
    activeQueryId,
    tabOrder,
    tabCount,
    selection,
    duplicatedTableNames,
    clearTabs,
    openTable,
    openQuery,
    closeTab,
    closeTabsByKeys,
    setTabView,
    renameTableTab,
    activateTableTab,
    closeDatabaseTabs,
  };
}
