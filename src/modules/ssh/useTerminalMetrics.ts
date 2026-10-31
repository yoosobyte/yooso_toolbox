import { useEffect, useRef, useState } from "react";
import { sshMetrics } from "../../api";
import type { MetricsSample } from "../../types";

interface TerminalMetricsState {
  metrics: MetricsSample | null;
  net: { rx: number; tx: number };
}

/**
 * 远端系统监控：会话激活时开始轮询（每 3 秒一次），
 * 并把累计流量换算成实时收发速率。
 */
export function useTerminalMetrics(
  sessionId: string | null,
  active: boolean,
): TerminalMetricsState {
  const [metrics, setMetrics] = useState<MetricsSample | null>(null);
  const [net, setNet] = useState({ rx: 0, tx: 0 });
  const netRef = useRef<{ rx: number; tx: number; at: number } | null>(null);

  useEffect(() => {
    if (!sessionId || !active) return;
    let cancelled = false;

    const tick = async () => {
      if (!sessionId) return;
      try {
        const sample = await sshMetrics(sessionId);
        if (cancelled) return;
        setMetrics(sample);

        const now = performance.now();
        const prev = netRef.current;
        if (prev && now > prev.at) {
          const seconds = (now - prev.at) / 1000;
          setNet({
            rx: Math.max(0, (sample.netRx - prev.rx) / seconds),
            tx: Math.max(0, (sample.netTx - prev.tx) / seconds),
          });
        }
        netRef.current = { rx: sample.netRx, tx: sample.netTx, at: now };
      } catch {
        /* 单次采集失败忽略 */
      }
    };

    // 刚连上就先取一次，让状态栏尽快有数据
    void tick();
    const boot = window.setTimeout(() => void tick(), 300);
    const timer = window.setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(boot);
      window.clearInterval(timer);
      netRef.current = null;
    };
  }, [sessionId, active]);

  return { metrics, net };
}
