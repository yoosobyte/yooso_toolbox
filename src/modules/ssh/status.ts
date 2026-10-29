import type { TabStatus } from "../../types";

/** 状态文案的 i18n key（term.connecting / term.connected / term.closed / term.error） */
export const STATUS_KEY: Record<TabStatus, string> = {
  connecting: "term.connecting",
  connected: "term.connected",
  closed: "term.closed",
  error: "term.error",
};

export const STATUS_COLOR: Record<TabStatus, string> = {
  connecting: "#f59e0b",
  connected: "#22c55e",
  closed: "#64748b",
  error: "#ef4444",
};
