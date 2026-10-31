import { useCallback, useEffect, useState } from "react";
import { App as AntdApp } from "antd";

import { sftpHome, sftpList } from "../../../api";
import { useT } from "../../../i18n";
import { useUiStore } from "../../../stores/uiStore";
import type { SftpEntry } from "../../../types";
import { errText } from "../../../utils";
import { sortEntries } from "./utils";

/**
 * SFTP 目录浏览状态：当前目录 / 条目 / 加载与选中状态，
 * 以及建立会话后进入用户主目录的初始化逻辑。
 */
export function useSftpDirectory(sessionId: string | null) {
  const { message } = AntdApp.useApp();
  const lang = useUiStore((state) => state.lang);
  const t = useT(lang);

  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [initError, setInitError] = useState<string | null>(null);

  const loadDir = useCallback(
    async (target: string) => {
      if (!sessionId) return;
      setLoading(true);
      try {
        const list = await sftpList(sessionId, target);
        setEntries(sortEntries(list));
        setPath(target);
        setSelected(null);
      } catch (error) {
        message.error(t("sftp.listFailed", { error: errText(error) }));
      } finally {
        setLoading(false);
      }
    },
    // useT 每次渲染都返回新函数，依赖 lang 即可保证文案随语言更新，同时避免 effect 反复重建
    [sessionId, message, lang],
  );

  /* 建立 SFTP 会话后进入用户主目录 */
  useEffect(() => {
    if (!sessionId) {
      setEntries([]);
      setPath("");
      setInitError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setInitError(null);
    void sftpHome(sessionId)
      .then((home) => {
        if (cancelled) return;
        return loadDir(home);
      })
      .catch((error) => {
        if (cancelled) return;
        setPath("");
        setEntries([]);
        setInitError(errText(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, reloadKey]);

  const retry = useCallback(() => setReloadKey((key) => key + 1), []);

  return {
    path,
    entries,
    loading,
    selected,
    setSelected,
    initError,
    loadDir,
    retry,
  };
}
