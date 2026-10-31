import { useState } from "react";
import { App as AntdApp, Spin } from "antd";
import { KeyOutlined, WarningOutlined } from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { copyText } from "../../clipboard";
import { errText } from "../../utils";
import { redisDelete, redisExpire, redisRename, redisSetString } from "./api";
import { ttlPresetSeconds } from "./browserTypes";
import RedisDetailHeader from "./RedisDetailHeader";
import { NewKeyDialog, RenameDialog, TtlDialog } from "./RedisKeyDialogs";
import RedisKeyPanel from "./RedisKeyPanel";
import RedisValueDetail from "./RedisValueDetail";
import { useRedisKeyDetail } from "./useRedisKeyDetail";
import { useRedisKeyList } from "./useRedisKeyList";

interface Props {
  connectionId: string;
  db: number;
  refreshToken: number;
}

export default function RedisBrowser({ connectionId, db, refreshToken }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const { message, modal } = AntdApp.useApp();

  const {
    selectedKey,
    detail,
    detailLoading,
    detailError,
    editValue,
    setEditValue,
    saving,
    structured,
    stringMode,
    setStringMode,
    jsonCollapsed,
    setJsonCollapsed,
    jsonPaths,
    selectKey,
    saveString,
    toggleJson,
    resetSelection,
    clearKey,
  } = useRedisKeyDetail(connectionId);

  const {
    pattern,
    setPattern,
    appliedPattern,
    keys,
    setKeys,
    hasMore,
    loading,
    loadingMore,
    listError,
    reloadList,
    loadMore,
  } = useRedisKeyList({
    connectionId,
    db,
    refreshToken,
    onSelectKey: selectKey,
    onNoKeys: resetSelection,
  });

  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newTtlPreset, setNewTtlPreset] = useState("never");
  const [newTtl, setNewTtl] = useState<number | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [ttlOpen, setTtlOpen] = useState(false);
  const [ttlValue, setTtlValue] = useState<number | null>(null);

  const copyKey = () => {
    if (!selectedKey) return;
    void copyText(selectedKey).then(
      () => message.success(t("redis.copied")),
      () => message.error(t("common.copyFailed")),
    );
  };

  const copyValue = (value: string) => {
    if (!value) return;
    void copyText(value).then(
      () => message.success(t("redis.copied")),
      () => message.error(t("common.copyFailed")),
    );
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
          clearKey();
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
      const ttlSeconds = ttlPresetSeconds(newTtlPreset, newTtl);
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

  return (
    <div className="redis-browser">
      <RedisKeyPanel
        pattern={pattern}
        onPatternChange={setPattern}
        appliedPattern={appliedPattern}
        keys={keys}
        loading={loading}
        listError={listError}
        hasMore={hasMore}
        loadingMore={loadingMore}
        selectedKey={selectedKey}
        onSearch={() => void reloadList(null)}
        onLoadMore={() => void loadMore()}
        onNewKey={openNewKey}
        onSelectKey={(key) => void selectKey(key)}
      />

      <section className="redis-detail">
        <RedisDetailHeader
          selectedKey={selectedKey}
          detail={detail}
          structured={structured}
          onCopyKey={copyKey}
          onRename={openRename}
          onSetTtl={openTtl}
          onRefresh={refreshDetail}
          onDelete={deleteSelected}
        />

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

          {!detailLoading && !detailError && detail && (
            <RedisValueDetail
              detail={detail}
              structured={structured}
              stringMode={stringMode}
              onStringModeChange={setStringMode}
              jsonCollapsed={jsonCollapsed}
              jsonPaths={jsonPaths}
              onToggleJson={toggleJson}
              onJsonCollapsedChange={setJsonCollapsed}
              editValue={editValue}
              onEditValueChange={setEditValue}
              saving={saving}
              onSave={() => void saveString()}
              onCopyValue={copyValue}
            />
          )}
        </div>
      </section>

      <NewKeyDialog
        open={newKeyOpen}
        keyName={newKey}
        value={newValue}
        ttlPreset={newTtlPreset}
        ttl={newTtl}
        onKeyNameChange={setNewKey}
        onValueChange={setNewValue}
        onTtlPresetChange={setNewTtlPreset}
        onTtlChange={setNewTtl}
        onCancel={() => setNewKeyOpen(false)}
        onOk={() => void createKey()}
      />

      <RenameDialog
        open={renameOpen}
        value={renameValue}
        onValueChange={setRenameValue}
        onCancel={() => setRenameOpen(false)}
        onOk={() => void doRename()}
      />

      <TtlDialog
        open={ttlOpen}
        value={ttlValue}
        onValueChange={setTtlValue}
        onCancel={() => setTtlOpen(false)}
        onOk={() => void doTtl()}
      />
    </div>
  );
}
