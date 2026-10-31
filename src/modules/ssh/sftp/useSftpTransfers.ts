import { useCallback, useEffect, useState } from "react";

import type { TransferItem } from "../../../types";

/** 传输进度列表：新增 / 更新 / 清空，并在全部结束后自动收起。 */
export function useSftpTransfers() {
  const [transfers, setTransfers] = useState<TransferItem[]>([]);

  /* 传输结束后自动收起传输列表，把空间还给文件列表（失败的多留几秒便于查看） */
  useEffect(() => {
    if (transfers.length === 0) return;
    if (transfers.some((item) => item.status === "running")) return;
    const hasError = transfers.some((item) => item.status === "error");
    const timer = window.setTimeout(() => setTransfers([]), hasError ? 4000 : 1200);
    return () => window.clearTimeout(timer);
  }, [transfers]);

  const patchTransfer = useCallback(
    (id: string, patch: Partial<TransferItem>) =>
      setTransfers((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item))),
    [],
  );

  const addTransfer = useCallback((name: string, direction: TransferItem["direction"]) => {
    const id = crypto.randomUUID();
    const item: TransferItem = { id, name, direction, percent: 0, status: "running" };
    setTransfers((list) => [item, ...list].slice(0, 10));
    return id;
  }, []);

  const clearTransfers = useCallback(() => setTransfers([]), []);

  return { transfers, addTransfer, patchTransfer, clearTransfers };
}
