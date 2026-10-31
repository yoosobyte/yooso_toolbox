import { useRef, useState } from "react";
import { App as AntdApp } from "antd";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import { redisKeyDetail, redisSetString, type RedisKeyDetail } from "./api";
import { collectContainerPaths, type JsonValue } from "../text/JsonTree";
import { isStructured, parseJsonLike } from "./jsonLike";
import type { RedisStringMode } from "./browserTypes";

/** 选中键的详情、字符串编辑与 JSON 树展示状态 */
export function useRedisKeyDetail(connectionId: string) {
  const t = useT(useUiStore((state) => state.lang));
  const { message } = AntdApp.useApp();

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<RedisKeyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const [structured, setStructured] = useState<JsonValue | null>(null);
  const [stringMode, setStringMode] = useState<RedisStringMode>("text");
  const [jsonCollapsed, setJsonCollapsed] = useState<Set<string>>(new Set());
  const [jsonPaths, setJsonPaths] = useState<string[]>([]);

  const detailRequest = useRef(0);

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

  const toggleJson = (path: string) => {
    setJsonCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  /** 扫描结果为空时：清空选中项和详情错误 */
  const resetSelection = () => {
    setSelectedKey(null);
    setDetail(null);
    setDetailError(null);
  };

  /** 删除成功后：只清空选中项和详情 */
  const clearKey = () => {
    setSelectedKey(null);
    setDetail(null);
  };

  return {
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
  };
}
