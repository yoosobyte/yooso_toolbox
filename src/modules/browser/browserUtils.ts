/** 百度对 Safari UA 的 https 页面会跳转到 http，导致 WebView 空白，需要 Chrome UA */
export const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const NEW_SITE_COLORS = [
  "#008373",
  "#2932e1",
  "#646cff",
  "#f48024",
  "#22c55e",
  "#a855f7",
  "#ec4899",
  "#06b6d4",
];

export function userAgentFor(url: string): string | undefined {
  try {
    const host = new URL(url).hostname;
    if (host === "baidu.com" || host.endsWith(".baidu.com")) return CHROME_UA;
  } catch {
    /* ignore */
  }
  return undefined;
}

export function normalizeUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  return `https://${value}`;
}

export function titleFor(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** 依次尝试的图标地址：站点自带 favicon → 第三方图标服务 */
export function faviconSources(url: string): string[] {
  const sources: string[] = [];
  try {
    const { origin, hostname } = new URL(url);
    sources.push(`${origin}/favicon.ico`);
    sources.push(`https://www.google.com/s2/favicons?domain=${hostname}&sz=64`);
    sources.push(`https://favicon.im/${hostname}?larger=true`);
  } catch {
    /* ignore */
  }
  return sources;
}
