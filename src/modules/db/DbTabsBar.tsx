import { CloseOutlined, FileTextOutlined, TableOutlined } from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import type { DbQueryDef } from "./queries";
import type { TableTab } from "./dbModuleTypes";
import useTabDragScroll from "./useTabDragScroll";

interface Props {
  tableTabs: TableTab[];
  openQueries: DbQueryDef[];
  effectiveTabKey: string | null;
  duplicatedTableNames: Set<string>;
  onSelectTableTab: (tab: TableTab) => void;
  onSelectQuery: (query: DbQueryDef) => void;
  onCloseTab: (key: string) => void;
  onTabContextMenu: (key: string, x: number, y: number) => void;
}

/** 主区域的页签栏：表页签 + SQL 查询页签，支持按住拖动横向滚动 */
export default function DbTabsBar({
  tableTabs,
  openQueries,
  effectiveTabKey,
  duplicatedTableNames,
  onSelectTableTab,
  onSelectQuery,
  onCloseTab,
  onTabContextMenu,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const {
    tabsBarRef,
    onTabsPointerDown,
    onTabsPointerMove,
    onTabsPointerUp,
    onTabsClickCapture,
  } = useTabDragScroll();

  return (
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
          onContextMenu={(event) => {
            event.preventDefault();
            onTabContextMenu(tab.key, event.clientX, event.clientY);
          }}
          onClick={() => onSelectTableTab(tab)}
          title={`${tab.table} (${tab.database})`}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelectTableTab(tab);
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
              onCloseTab(tab.key);
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
            onContextMenu={(event) => {
              event.preventDefault();
              onTabContextMenu(key, event.clientX, event.clientY);
            }}
            onClick={() => onSelectQuery(query)}
            title={`${query.name} (${query.database})`}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectQuery(query);
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
                onCloseTab(key);
              }}
            >
              <CloseOutlined />
            </button>
          </div>
        );
      })}
    </div>
  );
}
