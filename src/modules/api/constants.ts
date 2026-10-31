import type { HttpMethod } from "../../types";

export const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** 请求栏右侧图标按钮：和下拉 / 输入框严格等高 */
export const BAR_BTN = { height: 32, width: 32, minWidth: 32 } as const;

export const METHOD_COLOR: Record<string, string> = {
  GET: "#22c55e",
  POST: "#f59e0b",
  PUT: "#3b82f6",
  PATCH: "#a855f7",
  DELETE: "#f87171",
  HEAD: "#8b9bb4",
  OPTIONS: "#8b9bb4",
};

/** 请求区（参数 / 请求头 / 请求体）当前的 tab */
export type ReqTab = "params" | "headers" | "body";

/** 响应区（正文 / 响应头）当前的 tab */
export type RespTab = "body" | "headers";
