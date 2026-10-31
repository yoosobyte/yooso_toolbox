import { useState } from "react";
import { Button, Input } from "antd";
import {
  HistoryOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import type { HistoryEntry, SavedRequest } from "../../types";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import MethodChip from "./MethodChip";

interface Props {
  width: number;
  saved: SavedRequest[];
  history: HistoryEntry[];
  currentId: string | null;
  onNew: () => void;
  onLoad: (item: SavedRequest) => void;
  onRemove: (id: string) => void;
  onPickHistory: (item: HistoryEntry) => void;
  onClearHistory: () => void;
}

/** 左侧栏：新建按钮 + 搜索 + 已保存请求 / 历史列表 */
export default function RequestSidebar({
  width,
  saved,
  history,
  currentId,
  onNew,
  onLoad,
  onRemove,
  onPickHistory,
  onClearHistory,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const [keyword, setKeyword] = useState("");

  /** 左侧搜索过滤 */
  const keywordTrim = keyword.trim().toLowerCase();
  const shownSaved = keywordTrim
    ? saved.filter((item) => item.name.toLowerCase().includes(keywordTrim))
    : saved;
  const shownHistory = keywordTrim
    ? history.filter(
        (item) =>
          item.url.toLowerCase().includes(keywordTrim) ||
          item.method.toLowerCase().includes(keywordTrim),
      )
    : history;

  return (
    <aside className="api-side" style={{ width }}>
      <Button icon={<PlusOutlined />} block onClick={onNew}>
        {t("api.newRequest")}
      </Button>

      <div className="api-side-card">
        <div className="api-search">
          <Input
            variant="borderless"
            allowClear
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            prefix={<SearchOutlined style={{ color: "var(--text-mute)" }} />}
            placeholder={t("api.search")}
          />
        </div>
        <div className="api-search-sep" />

        <div className="api-side-scroll">
          <div className="api-group">
            <div className="api-group-head">
              <FolderOpenOutlined />
              <span>{t("api.requestSection")}</span>
              <span className="api-count">{saved.length}</span>
            </div>
            <div className="api-group-body">
            {shownSaved.length === 0 && (
              <div className="api-side-empty">
                {keywordTrim ? t("api.emptySearch") : t("api.emptySaved")}
              </div>
            )}
            {shownSaved.map((item) => (
              <div
                key={item.id}
                className={`api-item${item.id === currentId ? " active" : ""}`}
                onClick={() => onLoad(item)}
              >
                <MethodChip method={item.request.method} />
                <span className="api-item-name">{item.name}</span>
                <button
                  type="button"
                  className="api-item-remove"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(item.id);
                  }}
                >
                  <DeleteOutlined />
                </button>
              </div>
            ))}
            </div>
          </div>

          <div className="api-group">
            <div className="api-group-head">
              <HistoryOutlined />
              <span>{t("api.historySection")}</span>
              <span className="api-count">{history.length}</span>
              {history.length > 0 && (
                <button type="button" className="api-group-action" onClick={onClearHistory}>
                  <DeleteOutlined />
                  {t("api.clearHistory")}
                </button>
              )}
            </div>
            <div className="api-group-body">
            {shownHistory.length === 0 && (
              <div className="api-side-empty">
                {keywordTrim ? t("api.emptySearch") : t("api.emptyHistory")}
              </div>
            )}
            {shownHistory.map((item: HistoryEntry) => (
              <div
                key={item.id}
                className="api-item api-item-history"
                onClick={() => onPickHistory(item)}
              >
                <MethodChip method={item.method} />
                <span className="api-item-name" title={item.url}>
                  {item.url}
                </span>
                <span className="api-item-time">{dayjs(item.at).format("HH:mm")}</span>
              </div>
            ))}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
