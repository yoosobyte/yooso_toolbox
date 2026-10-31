import type { ReactNode } from "react";
import {
  ClearOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import type { DbQueryDef } from "./queries";
import type {
  DatabaseMenuState,
  QueryMenuState,
  TableMenuState,
  TableTarget,
  TabMenuState,
} from "./dbModuleTypes";

function MenuShell({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div
      className="db-context-menu"
      style={{ left: x, top: y }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

interface TableMenuProps {
  menu: TableMenuState;
  onCopyName: (table: string) => void;
  onRename: (target: TableTarget) => void;
  onNewTable: (database: string) => void;
  onNewQuery: (database: string) => void;
  onTruncate: (target: TableTarget) => void;
  onDrop: (target: TableTarget) => void;
  onCopyStructure: (target: TableTarget) => void;
  onExport: (target: TableTarget) => void;
}

/** 表的右键菜单 */
export function DbTableMenu({
  menu,
  onCopyName,
  onRename,
  onNewTable,
  onNewQuery,
  onTruncate,
  onDrop,
  onCopyStructure,
  onExport,
}: TableMenuProps) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <MenuShell x={menu.x} y={menu.y}>
      <button type="button" onClick={() => onCopyName(menu.table)}>
        <CopyOutlined />
        {t("db.copyTableName")}
      </button>
      <button type="button" onClick={() => onRename(menu)}>
        <EditOutlined />
        {t("db.renameTable")}
      </button>
      <button type="button" onClick={() => onNewTable(menu.database)}>
        <PlusOutlined />
        {t("db.newTable")}
      </button>
      <button type="button" onClick={() => onNewQuery(menu.database)}>
        <FileTextOutlined />
        {t("db.newQuery")}
      </button>
      <button type="button" onClick={() => onTruncate(menu)}>
        <ClearOutlined />
        {t("db.truncateTable")}
      </button>
      <button type="button" onClick={() => onDrop(menu)}>
        <DeleteOutlined />
        {t("db.dropTable")}
      </button>
      <button type="button" onClick={() => onCopyStructure(menu)}>
        <CopyOutlined />
        {t("db.copyStructure")}
      </button>
      <button type="button" onClick={() => onExport(menu)}>
        <DownloadOutlined />
        {t("db.copyStructureData")}
      </button>
    </MenuShell>
  );
}

interface DatabaseMenuProps {
  menu: DatabaseMenuState;
  onNewTable: (database: string) => void;
  onNewQuery: (database: string) => void;
  onCloseDatabase: (database: string) => void;
}

/** 数据库节点的右键菜单 */
export function DbDatabaseMenu({
  menu,
  onNewTable,
  onNewQuery,
  onCloseDatabase,
}: DatabaseMenuProps) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <MenuShell x={menu.x} y={menu.y}>
      <button type="button" onClick={() => onNewTable(menu.database)}>
        <PlusOutlined />
        {t("db.newTable")}
      </button>
      <button type="button" onClick={() => onNewQuery(menu.database)}>
        <FileTextOutlined />
        {t("db.newQuery")}
      </button>
      <button type="button" onClick={() => onCloseDatabase(menu.database)}>
        <CloseOutlined />
        {t("db.closeDatabase")}
      </button>
    </MenuShell>
  );
}

interface QueryMenuProps {
  menu: QueryMenuState;
  onNewQuery: (database: string) => void;
  onRename: (query: DbQueryDef) => void;
  onDelete: (query: DbQueryDef) => void;
}

/** 查询节点的右键菜单 */
export function DbQueryMenu({
  menu,
  onNewQuery,
  onRename,
  onDelete,
}: QueryMenuProps) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <MenuShell x={menu.x} y={menu.y}>
      <button
        type="button"
        onClick={() => onNewQuery(menu.query.database)}
      >
        <FileTextOutlined />
        {t("db.newQuery")}
      </button>
      <button type="button" onClick={() => onRename(menu.query)}>
        <EditOutlined />
        {t("db.renameQuery")}
      </button>
      <button type="button" onClick={() => onDelete(menu.query)}>
        <DeleteOutlined />
        {t("db.deleteQuery")}
      </button>
    </MenuShell>
  );
}

interface TabMenuProps {
  menu: TabMenuState;
  tabOrder: string[];
  onNewQuery: (database: string) => void;
  onCloseTab: (key: string) => void;
  onCloseOtherTabs: (key: string) => void;
  onCloseTabsLeft: (key: string) => void;
  onCloseTabsRight: (key: string) => void;
}

/** 页签的右键菜单 */
export function DbTabMenu({
  menu,
  tabOrder,
  onNewQuery,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsLeft,
  onCloseTabsRight,
}: TabMenuProps) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <MenuShell x={menu.x} y={menu.y}>
      <button
        type="button"
        disabled={!menu.database}
        onClick={() => onNewQuery(menu.database)}
      >
        <FileTextOutlined />
        {t("db.newQuery")}
      </button>
      <button type="button" onClick={() => onCloseTab(menu.key)}>
        <CloseOutlined />
        {t("db.closeTab")}
      </button>
      <button
        type="button"
        disabled={tabOrder.length <= 1}
        onClick={() => onCloseOtherTabs(menu.key)}
      >
        <CloseOutlined />
        {t("db.closeOtherTabs")}
      </button>
      <button
        type="button"
        disabled={tabOrder.indexOf(menu.key) <= 0}
        onClick={() => onCloseTabsLeft(menu.key)}
      >
        <CloseOutlined />
        {t("db.closeTabsLeft")}
      </button>
      <button
        type="button"
        disabled={tabOrder.indexOf(menu.key) >= tabOrder.length - 1}
        onClick={() => onCloseTabsRight(menu.key)}
      >
        <CloseOutlined />
        {t("db.closeTabsRight")}
      </button>
    </MenuShell>
  );
}
