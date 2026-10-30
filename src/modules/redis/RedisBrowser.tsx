import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  App as AntdApp,
  Button,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Spin,
  Tooltip,
} from "antd";
import {
  ApartmentOutlined,
  BarsOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  ExpandAltOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  HourglassOutlined,
  InboxOutlined,
  KeyOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  ShrinkOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { copyText } from "../../clipboard";
import { errText } from "../../utils";
import {
  redisDelete,
  redisExpire,
  redisKeyDetail,
  redisRename,
  redisScan,
  redisSetString,
  type RedisKeyDetail,
  type RedisKeyInfo,
  type RedisValue,
} from "./api";
import JsonTree, { collectContainerPaths, type JsonValue } from "../text/JsonTree";
import { buildKeyTree, type KeyTreeNode } from "./keyTree";
import { isStructured, parseJsonLike } from "./jsonLike";
import { formatTtlShort } from "./ttl";

interface Props {
  connectionId: string;
  db: number;
  refreshToken: number;
}

function normalizePattern(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "*";
  if (trimmed.includes("*") || trimmed.includes("?")) return trimmed;
  return `*${trimmed}*`;
}

export default function RedisBrowser({ connectionId, db, refreshToken }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const { message, modal } = AntdApp.useApp();

  const [pattern, setPattern] = useState("");
  const [appliedPattern, setAppliedPattern] = useState("*");
  const [keys, setKeys] = useState<RedisKeyInfo[]>([]);
  const [keyView, setKeyView] = useState<"tree" | "list">(() => {
    try {
      return localStorage.getItem("yooso.redis.keyView") === "list" ? "list" : "tree";
    } catch {
      return "tree";
    }
  });
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [structured, setStructured] = useState<JsonValue | null>(null);
  const [stringMode, setStringMode] = useState<"tree" | "text">("text");
  const [jsonCollapsed, setJsonCollapsed] = useState<Set<string>>(new Set());
  const [jsonPaths, setJsonPaths] = useState<string[]>([]);
  const [cursor, setCursor] = useState("0");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<RedisKeyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newTtlPreset, setNewTtlPreset] = useState("never");
  const [newTtl, setNewTtl] = useState<number | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [ttlOpen, setTtlOpen] = useState(false);
  const [ttlValue, setTtlValue] = useState<number | null>(null);

  const detailRequest = useRef(0);
  const listRequest = useRef(0);
  const tree = useMemo(() => buildKeyTree(keys), [keys]);

  useEffect(() => {
    try {
      localStorage.setItem("yooso.redis.keyView", keyView);
    } catch {
      /* 忽略存储失败 */
    }
  }, [keyView]);

  const ttlText = (ttl: number) => {
    if (ttl === -1) return t("redis.ttlNoExpire");
    if (ttl === -2) return t("redis.ttlExpired");
    return t("redis.ttlSeconds", { count: ttl });
  };

  const ttlShort = (ttl: number) => formatTtlShort(ttl);

  const selectKey = async (key: string) => {
    const request = ++detailRequest.current;
    setSelectedKey(key);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const next = await redisKeyDetail(connectionId, key);
      if (request !== detailRequest.current) return;
      setDetail(next);
      setEditValue(next.value.kind === "string" ? next.value.value : "");
      if (next.value.kind === "string") {
        const parsed = parseJsonLike(next.value.value);
        const nextStructured = isStructured(parsed) ? parsed : null;
        setStructured(nextStructured);
        setStringMode(nextStructured ? "tree" : "text");
        setJsonPaths(
          nextStructured ? collectContainerPaths(nextStructured).map((item) => item.path) : [],
        );
        setJsonCollapsed(new Set());
      } else {
        setStructured(null);
        setStringMode("text");
        setJsonPaths([]);
        setJsonCollapsed(new Set());
      }
    } catch (error) {
      if (request !== detailRequest.current) return;
      setDetailError(errText(error));
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  };

  const reloadList = async (select: string | null) => {
    const request = ++listRequest.current;
    const normalized = normalizePattern(pattern);
    setAppliedPattern(normalized);
    setLoading(true);
    setListError(null);
    try {
      const result = await redisScan(connectionId, "0", normalized, 200);
      if (request !== listRequest.current) return;
      setKeys(result.keys);
      setCursor(result.cursor);
      setHasMore(result.cursor !== "0");
      if (select) {
        void selectKey(select);
      } else if (result.keys.length > 0) {
        void selectKey(result.keys[0].key);
      } else {
        setSelectedKey(null);
        setDetail(null);
        setDetailError(null);
      }
    } catch (error) {
      if (request !== listRequest.current) return;
      setListError(errText(error));
      setKeys([]);
      setCursor("0");
      setHasMore(false);
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  };

  useEffect(() => {
    void reloadList(null);
  }, [db, refreshToken]);

  const loadMore = async () => {
    if (!hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const result = await redisScan(connectionId, cursor, appliedPattern, 200);
      setKeys((prev) => {
        const seen = new Set(prev.map((item) => item.key));
        const extra = result.keys.filter((item) => !seen.has(item.key));
        return [...prev, ...extra];
      });
      setCursor(result.cursor);
      setHasMore(result.cursor !== "0");
    } catch (error) {
      message.error(errText(error));
    } finally {
      setLoadingMore(false);
    }
  };

  const copyKey = () => {
    if (!selectedKey) return;
    void copyText(selectedKey).then(
      () => message.success(t("redis.copied")),
      () => message.error(t("common.copyFailed")),
    );
  };

  const saveString = async () => {
    if (!detail || detail.value.kind !== "string") return;
    setSaving(true);
    try {
      await redisSetString(connectionId, detail.key, editValue, null, true, false);
      message.success(t("redis.saved"));
      await selectKey(detail.key);
    } catch (error) {
      message.error(t("redis.saveFailed", { error: errText(error) }));
    } finally {
      setSaving(false);
    }
  };

  const refreshDetail = () => {
    if (selectedKey) void selectKey(selectedKey);
  };

  const openRename = () => {
    if (!selectedKey) return;
    setRenameValue(selectedKey);
    setRenameOpen(true);
  };

  const doRename = async () => {
    if (!selectedKey || !renameValue.trim()) return;
    const next = renameValue.trim();
    try {
      await redisRename(connectionId, selectedKey, next);
      message.success(t("redis.renameDone"));
      setRenameOpen(false);
      await reloadList(next);
    } catch (error) {
      message.error(errText(error));
    }
  };

  const openTtl = () => {
    if (!detail) return;
    setTtlValue(detail.ttl === -2 ? -1 : detail.ttl);
    setTtlOpen(true);
  };

  const doTtl = async () => {
    if (!selectedKey) return;
    const seconds = ttlValue === null || Number.isNaN(ttlValue) ? -1 : ttlValue;
    try {
      await redisExpire(connectionId, selectedKey, seconds);
      message.success(t("redis.ttlDone"));
      setTtlOpen(false);
      setKeys((prev) =>
        prev.map((item) =>
          item.key === selectedKey ? { ...item, ttl: seconds < 0 ? -1 : seconds } : item,
        ),
      );
      await selectKey(selectedKey);
    } catch (error) {
      message.error(errText(error));
    }
  };

  const deleteSelected = () => {
    if (!selectedKey) return;
    modal.confirm({
      title: t("redis.deleteKey"),
      content: t("redis.deleteKeyConfirm", { key: selectedKey }),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const count = await redisDelete(connectionId, [selectedKey]);
          message.success(t("redis.deletedCount", { count }));
          setSelectedKey(null);
          setDetail(null);
          await reloadList(null);
        } catch (error) {
          message.error(errText(error));
        }
      },
    });
  };

  const openNewKey = () => {
    setNewKey("");
    setNewValue("");
    setNewTtlPreset("never");
    setNewTtl(null);
    setNewKeyOpen(true);
  };

  const createKey = async () => {
    if (!newKey.trim()) return;
    try {
      const ttlSeconds =
        newTtlPreset === "custom"
          ? newTtl && newTtl > 0
            ? newTtl
            : null
          : newTtlPreset === "never"
            ? null
            : Number(newTtlPreset);
      await redisSetString(connectionId, newKey.trim(), newValue, ttlSeconds, false, true);
      message.success(t("redis.created"));
      const created = newKey.trim();
      setNewKeyOpen(false);
      setNewKey("");
      setNewValue("");
      setNewTtl(null);
      setNewTtlPreset("never");
      await reloadList(created);
    } catch (error) {
      const text = errText(error);
      message.error(/已存在/.test(text) ? t("redis.keyExists") : text);
    }
  };

  const jsonAllExpanded = jsonPaths.length === 0 || jsonCollapsed.size === 0;

  const toggleJson = (path: string) => {
    setJsonCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleFolder = (id: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyValue = (value: string) => {
    if (!value) return;
    void copyText(value).then(
      () => message.success(t("redis.copied")),
      () => message.error(t("common.copyFailed")),
    );
  };

  const renderTree = (nodes: KeyTreeNode[], depth: number): ReactNode =>
    nodes.map((node) => {
      const info = node.key;
      if (!info) {
        const collapsed = collapsedFolders.has(node.id);
        return (
          <Fragment key={node.id}>
            <div
              className="redis-tree-folder"
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => toggleFolder(node.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggleFolder(node.id);
                }
              }}
            >
              <span className="redis-tree-caret">
                {collapsed ? <RightOutlined /> : <DownOutlined />}
              </span>
              {collapsed ? <FolderOutlined /> : <FolderOpenOutlined />}
              <span className="redis-tree-folder-name" title={node.path}>
                {node.name}
              </span>
              <span className="redis-tree-count">{node.count}</span>
            </div>
            {!collapsed && renderTree(node.children, depth + 1)}
          </Fragment>
        );
      }

      return (
        <div
          key={node.id}
          className={`redis-key-row redis-tree-leaf${info.key === selectedKey ? " active" : ""}`}
          style={{ paddingLeft: 11 + depth * 12 }}
          onClick={() => void selectKey(info.key)}
        >
          <span className="redis-tree-key-icon">
            <KeyOutlined />
          </span>
          <span className="redis-key-name" title={info.key}>
            {node.name}
          </span>
          <span className={`redis-type-badge redis-type-${info.kind}`}>{info.kind}</span>
          <span className="redis-key-ttl" title={ttlText(info.ttl)}>
            {ttlShort(info.ttl)}
          </span>
        </div>
      );
    });

  const renderValue = (next: RedisKeyDetail) => {
    const value: RedisValue = next.value;
    switch (value.kind) {
      case "none":
        return (
          <div className="redis-empty">
            <span className="redis-empty-icon">
              <InboxOutlined />
            </span>
            <div>{t("redis.none")}</div>
          </div>
        );
      case "string":
        return (
          <div className="redis-string-editor">
            {structured !== null && (
              <div className="redis-string-toolbar">
                <Segmented
                  size="small"
                  value={stringMode}
                  onChange={(next) => setStringMode(next as "tree" | "text")}
                  options={[
                    { value: "tree", label: t("text.tree") },
                    { value: "text", label: t("text.raw") },
                  ]}
                />
                {stringMode === "tree" && jsonPaths.length > 0 && (
                  <Button
                    size="small"
                    type="text"
                    icon={jsonAllExpanded ? <ShrinkOutlined /> : <ExpandAltOutlined />}
                    onClick={() =>
                      setJsonCollapsed(jsonAllExpanded ? new Set(jsonPaths) : new Set())
                    }
                  >
                    {jsonAllExpanded ? t("text.collapseAll") : t("text.expandAll")}
                  </Button>
                )}
                <span style={{ flex: 1 }} />
                <Tooltip title={t("redis.copyValue")} placement="left">
                  <Button
                    size="small"
                    type="text"
                    className="redis-copy-value"
                    icon={<CopyOutlined />}
                    onClick={() => copyValue(value.value)}
                  />
                </Tooltip>
              </div>
            )}

            {structured !== null && stringMode === "tree" ? (
              <div className="redis-json-tree">
                <JsonTree
                  value={structured}
                  collapsed={jsonCollapsed}
                  onToggle={toggleJson}
                  itemsLabel={t("text.items")}
                  keysLabel={t("text.keys")}
                />
              </div>
            ) : (
              <>
                <textarea
                  className="redis-string-input"
                  value={editValue}
                  spellCheck={false}
                  onChange={(event) => setEditValue(event.target.value)}
                />
                <div className="redis-string-foot">
                  <span className="redis-hint">{t("redis.stringHint")}</span>
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => void saveString()}
                    loading={saving}
                    disabled={editValue === value.value}
                  >
                    {t("redis.save")}
                  </Button>
                </div>
              </>
            )}
          </div>
        );
      case "hash":
        return (
          <div className="redis-value-scroll">
            <div className="redis-kv-head">
              <span>{t("redis.field")}</span>
              <span>{t("redis.valueColumn")}</span>
            </div>
            {value.entries.map((entry) => (
              <div className="redis-kv-row" key={entry.field}>
                <span className="redis-mono">{entry.field}</span>
                <span className="redis-mono">{entry.value}</span>
              </div>
            ))}
            {value.truncated && (
              <div className="redis-truncated">{t("redis.truncated", { limit: 500 })}</div>
            )}
          </div>
        );
      case "list":
        return (
          <div className="redis-value-scroll">
            {value.items.map((item, index) => (
              <div className="redis-list-row" key={index}>
                <span className="redis-index">{index + 1}</span>
                <span className="redis-mono">{item}</span>
              </div>
            ))}
            {value.truncated && (
              <div className="redis-truncated">{t("redis.truncated", { limit: 500 })}</div>
            )}
          </div>
        );
      case "set":
        return (
          <div className="redis-value-scroll">
            <div className="redis-chip-list">
              {value.items.map((item, index) => (
                <span className="redis-chip redis-mono" key={`${item}-${index}`}>
                  {item}
                </span>
              ))}
            </div>
            {value.truncated && (
              <div className="redis-truncated">{t("redis.truncated", { limit: 500 })}</div>
            )}
          </div>
        );
      case "zset":
        return (
          <div className="redis-value-scroll">
            <div className="redis-kv-head">
              <span>{t("redis.member")}</span>
              <span>{t("redis.score")}</span>
            </div>
            {value.items.map((item, index) => (
              <div className="redis-kv-row" key={`${item.member}-${index}`}>
                <span className="redis-mono">{item.member}</span>
                <span className="redis-mono">{item.score}</span>
              </div>
            ))}
            {value.truncated && (
              <div className="redis-truncated">{t("redis.truncated", { limit: 500 })}</div>
            )}
          </div>
        );
      case "stream":
        return (
          <div className="redis-value-scroll">
            {value.entries.map((entry) => (
              <div className="redis-stream-row" key={entry.id}>
                <div className="redis-stream-id">
                  {t("redis.streamId")}: {entry.id}
                </div>
                {entry.fields.map((field, index) => (
                  <div className="redis-kv-row" key={`${entry.id}-${index}`}>
                    <span className="redis-mono">{field.field}</span>
                    <span className="redis-mono">{field.value}</span>
                  </div>
                ))}
              </div>
            ))}
            {value.truncated && (
              <div className="redis-truncated">{t("redis.truncated", { limit: 100 })}</div>
            )}
          </div>
        );
      default:
        return (
          <div className="redis-empty">
            <span className="redis-empty-icon">
              <WarningOutlined />
            </span>
            <div>{t("redis.unsupportedType", { type: value.kind })}</div>
          </div>
        );
    }
  };

  return (
    <div className="redis-browser">
      <section className="redis-key-panel">
        <div className="redis-key-toolbar">
          <Input
            size="small"
            allowClear
            value={pattern}
            prefix={<SearchOutlined style={{ color: "var(--text-mute)" }} />}
            placeholder={t("redis.patternPlaceholder")}
            onChange={(event) => setPattern(event.target.value)}
            onPressEnter={() => void reloadList(null)}
          />
          <Tooltip title={t("redis.search")}>
            <Button
              size="small"
              icon={<SearchOutlined />}
              onClick={() => void reloadList(null)}
            />
          </Tooltip>
          <Tooltip title={t("redis.newKey")}>
            <Button
              size="small"
              type="text"
              icon={<PlusOutlined />}
              onClick={openNewKey}
            />
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
            tree.length > 0 &&
            renderTree(tree, 0)}
          {!loading &&
            !listError &&
            keyView === "list" &&
            keys.map((item) => (
              <div
                key={item.key}
                className={`redis-key-row${item.key === selectedKey ? " active" : ""}`}
                onClick={() => void selectKey(item.key)}
              >
                <span className="redis-key-name" title={item.key}>
                  {item.key}
                </span>
                <span className={`redis-type-badge redis-type-${item.kind}`}>{item.kind}</span>
                <span className="redis-key-ttl" title={ttlText(item.ttl)}>
                  {ttlShort(item.ttl)}
                </span>
              </div>
            ))}
        </div>

        {hasMore && (
          <div className="redis-key-foot">
            <Button size="small" type="text" loading={loadingMore} onClick={() => void loadMore()}>
              {t("redis.loadMore")}
            </Button>
          </div>
        )}
      </section>

      <section className="redis-detail">
        <div className="redis-detail-head">
          <KeyOutlined className="redis-detail-icon" />
          <span className="redis-detail-key" title={selectedKey ?? undefined}>
            {selectedKey ?? t("redis.detailTitle")}
          </span>
          {detail && (
            <>
              <span className={`redis-type-badge redis-type-${detail.kind}`}>{detail.kind}</span>
              {structured !== null && <span className="redis-json-badge">JSON</span>}
              <span className="redis-detail-meta">
                {ttlText(detail.ttl)}
                {detail.size !== null && detail.size !== undefined
                  ? ` · ${t("redis.sizeLabel")} ${detail.size}`
                  : ""}
              </span>
            </>
          )}
          <span style={{ flex: 1 }} />
          {detail && (
            <>
              <Tooltip title={t("redis.copyKey")}>
                <Button size="small" type="text" icon={<CopyOutlined />} onClick={copyKey} />
              </Tooltip>
              <Tooltip title={t("redis.rename")}>
                <Button size="small" type="text" icon={<EditOutlined />} onClick={openRename} />
              </Tooltip>
              <Tooltip title={t("redis.setTtl")}>
                <Button size="small" type="text" icon={<HourglassOutlined />} onClick={openTtl} />
              </Tooltip>
              <Tooltip title={t("redis.refreshDetail")}>
                <Button size="small" type="text" icon={<ReloadOutlined />} onClick={refreshDetail} />
              </Tooltip>
              <Tooltip title={t("redis.deleteKey")}>
                <Button
                  size="small"
                  type="text"
                  icon={<DeleteOutlined />}
                  onClick={deleteSelected}
                />
              </Tooltip>
            </>
          )}
        </div>

        <div className="redis-detail-body">
          {detailLoading && (
            <div className="redis-detail-loading">
              <Spin size="small" />
            </div>
          )}

          {!detailLoading && detailError && (
            <div className="redis-list-error">
              <WarningOutlined /> {detailError}
            </div>
          )}

          {!detailLoading && !detailError && !detail && (
            <div className="redis-empty">
              <span className="redis-empty-icon">
                <KeyOutlined />
              </span>
              <div>{t("redis.detailEmpty")}</div>
            </div>
          )}

          {!detailLoading && !detailError && detail && renderValue(detail)}
        </div>
      </section>

      <Modal
        open={newKeyOpen}
        title={t("redis.newKeyTitle")}
        onCancel={() => setNewKeyOpen(false)}
        onOk={() => void createKey()}
        okText={t("redis.create")}
        okButtonProps={{ disabled: !newKey.trim() }}
        cancelText={t("common.cancel")}
        width={460}
        destroyOnHidden
      >
        <div className="redis-form">
          <label className="redis-field">
            <span className="redis-label">{t("redis.keyName")}</span>
            <Input
              value={newKey}
              placeholder={t("redis.keyPlaceholder")}
              onChange={(event) => setNewKey(event.target.value)}
            />
          </label>
          <label className="redis-field">
            <span className="redis-label">{t("redis.value")}</span>
            <Input.TextArea
              value={newValue}
              autoSize={{ minRows: 3, maxRows: 6 }}
              placeholder={t("redis.valuePlaceholder")}
              onChange={(event) => setNewValue(event.target.value)}
            />
          </label>
          <label className="redis-field">
            <span className="redis-label">{t("redis.ttlOptional")}</span>
            <Select
              value={newTtlPreset}
              onChange={(value) => setNewTtlPreset(String(value))}
              options={[
                { value: "never", label: t("redis.ttlNoExpire") },
                { value: "3600", label: t("redis.ttlHour") },
                { value: "86400", label: t("redis.ttlDay") },
                { value: "604800", label: t("redis.ttlWeek") },
                { value: "custom", label: t("redis.ttlCustom") },
              ]}
            />
            {newTtlPreset === "custom" && (
              <InputNumber
                min={1}
                value={newTtl}
                placeholder={t("redis.ttlHint")}
                onChange={(value) => setNewTtl(value === null ? null : Number(value))}
                style={{ width: "100%" }}
              />
            )}
          </label>
        </div>
      </Modal>

      <Modal
        open={renameOpen}
        title={t("redis.renameTitle")}
        onCancel={() => setRenameOpen(false)}
        onOk={() => void doRename()}
        okText={t("common.confirm")}
        okButtonProps={{ disabled: !renameValue.trim() }}
        cancelText={t("common.cancel")}
        width={420}
        destroyOnHidden
      >
        <Input
          value={renameValue}
          placeholder={t("redis.renamePlaceholder")}
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={() => void doRename()}
        />
      </Modal>

      <Modal
        open={ttlOpen}
        title={t("redis.ttlTitle")}
        onCancel={() => setTtlOpen(false)}
        onOk={() => void doTtl()}
        okText={t("common.confirm")}
        cancelText={t("common.cancel")}
        width={420}
        destroyOnHidden
      >
        <div className="redis-form">
          <InputNumber
            min={-1}
            autoFocus
            value={ttlValue}
            placeholder={t("redis.ttlHint")}
            onChange={(value) => setTtlValue(value === null ? null : Number(value))}
            style={{ width: "100%" }}
          />
          <span className="redis-hint">{t("redis.ttlHint")}</span>
        </div>
      </Modal>
    </div>
  );
}
