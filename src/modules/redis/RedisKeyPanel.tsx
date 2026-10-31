import { useEffect, useMemo, useState } from "react";
import { Button, Input, Spin, Tooltip } from "antd";
import {
  ApartmentOutlined,
  BarsOutlined,
  PlusOutlined,
  SearchOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import type { RedisKeyInfo } from "./api";
import { buildKeyTree } from "./keyTree";
import KeyTreeView from "./KeyTreeView";
import {
  formatTtlLabel,
  KEY_VIEW_STORAGE,
  readStoredKeyView,
  type RedisKeyView,
} from "./browserTypes";
import { formatTtlShort } from "./ttl";

interface Props {
  pattern: string;
  onPatternChange: (value: string) => void;
  appliedPattern: string;
  keys: RedisKeyInfo[];
  loading: boolean;
  listError: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  selectedKey: string | null;
  onSearch: () => void;
  onLoadMore: () => void;
  onNewKey: () => void;
  onSelectKey: (key: string) => void;
}

/** 左侧键面板：搜索、树/列表切换、键列表和分页 */
export default function RedisKeyPanel({
  pattern,
  onPatternChange,
  appliedPattern,
  keys,
  loading,
  listError,
  hasMore,
  loadingMore,
  selectedKey,
  onSearch,
  onLoadMore,
  onNewKey,
  onSelectKey,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const [keyView, setKeyView] = useState<RedisKeyView>(readStoredKeyView);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildKeyTree(keys), [keys]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY_VIEW_STORAGE, keyView);
    } catch {
      /* 忽略存储失败 */
    }
  }, [keyView]);

  const toggleFolder = (id: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section className="redis-key-panel">
      <div className="redis-key-toolbar">
        <Input
          size="small"
          allowClear
          value={pattern}
          prefix={<SearchOutlined style={{ color: "var(--text-mute)" }} />}
          placeholder={t("redis.patternPlaceholder")}
          onChange={(event) => onPatternChange(event.target.value)}
          onPressEnter={onSearch}
        />
        <Tooltip title={t("redis.search")}>
          <Button size="small" icon={<SearchOutlined />} onClick={onSearch} />
        </Tooltip>
        <Tooltip title={t("redis.newKey")}>
          <Button size="small" type="text" icon={<PlusOutlined />} onClick={onNewKey} />
        </Tooltip>
        <Tooltip title={keyView === "tree" ? t("redis.listView") : t("redis.treeView")}>
          <Button
            size="small"
            type="text"
            icon={keyView === "tree" ? <BarsOutlined /> : <ApartmentOutlined />}
            onClick={() => setKeyView(keyView === "tree" ? "list" : "tree")}
          />
        </Tooltip>
      </div>

      <div className="redis-key-summary">
        <span>{t("redis.keysCount", { count: keys.length })}</span>
        <span className="redis-hint">{appliedPattern}</span>
      </div>

      <div className="redis-key-list">
        {loading && (
          <div className="redis-key-loading">
            <Spin size="small" />
          </div>
        )}
        {!loading && listError && (
          <div className="redis-list-error">
            <WarningOutlined /> {listError}
          </div>
        )}
        {!loading && !listError && keys.length === 0 && (
          <div className="redis-side-empty">{t("redis.noKeys")}</div>
        )}
        {!loading &&
          !listError &&
          keyView === "tree" &&
          tree.length > 0 && (
            <KeyTreeView
              nodes={tree}
              depth={0}
              collapsedFolders={collapsedFolders}
              selectedKey={selectedKey}
              onToggleFolder={toggleFolder}
              onSelectKey={onSelectKey}
            />
          )}
        {!loading &&
          !listError &&
          keyView === "list" &&
          keys.map((item) => (
            <div
              key={item.key}
              className={`redis-key-row${item.key === selectedKey ? " active" : ""}`}
              onClick={() => onSelectKey(item.key)}
            >
              <span className="redis-key-name" title={item.key}>
                {item.key}
              </span>
              <span className={`redis-type-badge redis-type-${item.kind}`}>{item.kind}</span>
              <span className="redis-key-ttl" title={formatTtlLabel(item.ttl, t)}>
                {formatTtlShort(item.ttl)}
              </span>
            </div>
          ))}
      </div>

      {hasMore && (
        <div className="redis-key-foot">
          <Button size="small" type="text" loading={loadingMore} onClick={onLoadMore}>
            {t("redis.loadMore")}
          </Button>
        </div>
      )}
    </section>
  );
}
