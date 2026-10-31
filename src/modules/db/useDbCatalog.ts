import { useRef, useState } from "react";
import { dbDatabases, dbTables, type DbTableInfo } from "./api";
import { errText } from "../../utils";
import { pickDatabase, type ConnectionIdRef } from "./dbModuleTypes";

/**
 * 左侧库/表树的数据：库列表、展开状态、按库缓存的表列表与加载/错误状态。
 * 只负责取数与缓存，不涉及页签和查询定义。
 */
export default function useDbCatalog(activeIdRef: ConnectionIdRef) {
  const [databases, setDatabases] = useState<string[]>([]);
  const [activeDatabase, setActiveDatabase] = useState<string | null>(null);
  const [expandedDatabases, setExpandedDatabases] = useState<Set<string>>(new Set());
  const [tablesByDb, setTablesByDb] = useState<Record<string, DbTableInfo[]>>({});
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [loadingTableDbs, setLoadingTableDbs] = useState<Set<string>>(new Set());
  const [treeError, setTreeError] = useState<string | null>(null);
  const dbRequest = useRef(0);

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

  const expandDatabase = (database: string) => {
    setExpandedDatabases((prev) => new Set(prev).add(database));
  };

  /** 关闭数据库时丢弃它的展开状态、表缓存与选中态 */
  const forgetDatabase = (database: string) => {
    setExpandedDatabases((prev) => {
      const next = new Set(prev);
      next.delete(database);
      return next;
    });
    setTablesByDb((prev) => {
      const next = { ...prev };
      delete next[database];
      return next;
    });
    setActiveDatabase((current) => (current === database ? null : current));
  };

  const toggleDatabase = (database: string) => {
    const connectionId = activeIdRef.current;
    if (!connectionId) return;
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
      void loadTablesFor(connectionId, database);
    }
  };

  /** 断开/删除连接时清空当前库树（不清加载中与错误标记，保持原行为） */
  const resetCatalog = () => {
    setDatabases([]);
    setExpandedDatabases(new Set());
    setTablesByDb({});
    setActiveDatabase(null);
  };

  return {
    databases,
    activeDatabase,
    expandedDatabases,
    tablesByDb,
    loadingDatabases,
    loadingTableDbs,
    treeError,
    setActiveDatabase,
    loadTablesFor,
    loadDatabases,
    toggleDatabase,
    expandDatabase,
    forgetDatabase,
    resetCatalog,
  };
}
