import type { ApiRequest, KeyValue } from "../../types";

/** 新建一行键值（参数 / 请求头） */
export const emptyRow = (): KeyValue => ({
  id: crypto.randomUUID(),
  key: "",
  value: "",
  enabled: true,
});

/** 空请求：GET + 参数 / 请求头各一条空行 */
export const emptyRequest = (): ApiRequest => ({
  method: "GET",
  url: "",
  params: [emptyRow()],
  headers: [emptyRow()],
  bodyType: "none",
  body: "",
});

/** 把 URL 里已有的 query 拆出来，避免和参数表重复 */
export function splitQuery(url: string): { base: string; pairs: [string, string][] } {
  const index = url.indexOf("?");
  if (index < 0) return { base: url, pairs: [] };
  const base = url.slice(0, index);
  const pairs: [string, string][] = url
    .slice(index + 1)
    .split("&")
    .filter(Boolean)
    .map((chunk) => {
      const [key, value = ""] = chunk.split("=");
      return [decodeURIComponent(key), decodeURIComponent(value)] as [string, string];
    });
  return { base, pairs };
}

/** 最终地址：URL 里已有的 query + 参数表里启用的行 */
export function buildFinalUrl(request: ApiRequest): string {
  const { base, pairs } = splitQuery(request.url.trim());
  const extra = request.params
    .filter((item) => item.enabled && item.key.trim())
    .map((item) => [item.key.trim(), item.value] as [string, string]);
  const merged = [...pairs];
  for (const [key, value] of extra) {
    const index = merged.findIndex(([existing]) => existing === key);
    if (index >= 0) merged[index] = [key, value];
    else merged.push([key, value]);
  }
  if (!merged.length) return base;
  const query = merged
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${base}?${query}`;
}

/** 状态码配色 */
export function statusColor(status: number): string {
  return status >= 200 && status < 300
    ? "var(--success)"
    : status >= 400
      ? "var(--danger)"
      : "var(--warn)";
}

/** 取 URL 的源（scheme://host），判断还是不是同一个接口 */
export function originOf(url: string): string {
  try {
    return new URL(url.trim()).origin;
  } catch {
    return url.trim();
  }
}

/** 生成等价的 cURL 命令 */
export function buildCurl(
  request: ApiRequest,
  finalUrl: string,
  enabledHeaders: { key: string; value: string }[],
): string {
  const lines = [`curl -X ${request.method} '${finalUrl}'`];
  const headers = [...enabledHeaders];
  const hasType = headers.some((item) => item.key.toLowerCase() === "content-type");
  if (!hasType && request.bodyType === "json") {
    headers.push({ key: "Content-Type", value: "application/json" });
  }
  if (!hasType && request.bodyType === "form") {
    headers.push({ key: "Content-Type", value: "application/x-www-form-urlencoded" });
  }
  for (const header of headers) {
    lines.push(`-H '${header.key}: ${header.value.replace(/'/g, "'\\''")}'`);
  }
  if (request.bodyType !== "none" && request.body.trim()) {
    lines.push(`--data-raw '${request.body.replace(/'/g, "'\\''")}'`);
  }
  return lines.join(" \\\n  ");
}
