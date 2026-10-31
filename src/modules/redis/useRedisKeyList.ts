import { useEffect, useRef, useState } from "react";
import { App as AntdApp } from "antd";
import { errText } from "../../utils";
import { redisScan, type RedisKeyInfo } from "./api";
import { normalizePattern } from "./browserTypes";

interface Options {
  connectionId: string;
  db: number;
  refreshToken: number;
  onSelectKey: (key: string) => void | Promise<void>;
  onNoKeys: () => void;
}

/** 键扫描 / 分页加载状态 */
export function useRedisKeyList({
  connectionId,
  db,
  refreshToken,
  onSelectKey,
  onNoKeys,
}: Options) {
  const { message } = AntdApp.useApp();

  const [pattern, setPattern] = useState("");
  const [appliedPattern, setAppliedPattern] = useState("*");
  const [keys, setKeys] = useState<RedisKeyInfo[]>([]);
  const [cursor, setCursor] = useState("0");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const listRequest = useRef(0);

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
        void onSelectKey(select);
      } else if (result.keys.length > 0) {
        void onSelectKey(result.keys[0].key);
      } else {
        onNoKeys();
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

  return {
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
  };
}
