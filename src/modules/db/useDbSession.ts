import { useEffect, useState } from "react";
import { App as AntdApp } from "antd";
import { useDbStore } from "../../stores/dbStore";
import { dbConnect, dbDisconnect, type DbConfig, type DbConnectInfo } from "./api";
import { errText } from "../../utils";
import type { TFunction } from "../../i18n";
import type { ConnectionIdRef } from "./dbModuleTypes";

interface Options {
  t: TFunction;
  activeIdRef: ConnectionIdRef;
  /** 连接切换/断开时要清空的页签 */
  clearTabs: () => void;
  /** 连接切换/断开时要清空的库树 */
  resetCatalog: () => void;
  loadDatabases: (connectionId: string, preferred: string | null) => Promise<void>;
  activeDatabase: string | null;
}

/** 当前连接会话：连接/断开、连接信息、树展开与筛选、刷新库树 */
export default function useDbSession({
  t,
  activeIdRef,
  clearTabs,
  resetCatalog,
  loadDatabases,
  activeDatabase,
}: Options) {
  const { message } = AntdApp.useApp();
  const load = useDbStore((state) => state.load);
  const markUsed = useDbStore((state) => state.markUsed);

  const [active, setActive] = useState<DbConfig | null>(null);
  const [info, setInfo] = useState<DbConnectInfo | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectionExpanded, setConnectionExpanded] = useState(true);
  const [tableFilter, setTableFilter] = useState("");

  useEffect(() => {
    void load();
  }, [load]);

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

  /** 静默清理当前连接的前端状态（不提示，供断开/删除/修改配置复用） */
  const resetConnectionState = async (connectionId: string) => {
    await dbDisconnect(connectionId).catch(() => undefined);
    activeIdRef.current = null;
    setActive(null);
    setInfo(null);
    resetCatalog();
    setConnectionExpanded(true);
    clearTabs();
  };

  /** 只改了名字/颜色等展示信息时，直接替换当前连接配置 */
  const setActiveConfig = (config: DbConfig) => {
    setActive(config);
  };

  const disconnect = async () => {
    if (!active) return;
    await resetConnectionState(active.id);
    message.success(t("db.disconnected"));
  };

  const toggleConnection = (config: DbConfig) => {
    if (active?.id === config.id) {
      setConnectionExpanded((value) => !value);
    } else {
      void connect(config);
    }
  };

  const refreshTree = () => {
    if (!active) return;
    void loadDatabases(active.id, activeDatabase);
  };

  return {
    active,
    info,
    connectingId,
    connectionExpanded,
    tableFilter,
    setTableFilter,
    connect,
    resetConnectionState,
    setActiveConfig,
    disconnect,
    toggleConnection,
    refreshTree,
  };
}
