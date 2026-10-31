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

/** 地址栏的搜索引擎 */
export type SearchEngine = "bing" | "baidu";

export const SEARCH_ENGINES: SearchEngine[] = ["bing", "baidu"];

export function searchUrlFor(query: string, engine: SearchEngine): string {
  const value = encodeURIComponent(query.trim());
  return engine === "baidu"
    ? `https://www.baidu.com/s?wd=${value}`
    : `https://www.bing.com/search?q=${value}`;
}

/**
 * 地址栏输入：写了协议的直接当网址；不带点、或带空格（明显是一句话）
 * 的当搜索词，交给选中的搜索引擎；其余按域名补 https://。
 */
export function toUrlOrSearch(raw: string, engine: SearchEngine): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  if (/\s/.test(value) || !value.includes(".")) {
    return searchUrlFor(value, engine);
  }
  return `https://${value}`;
}

/** 浏览器模块自己的偏好（搜索引擎 / 是否隐藏顶部栏），存在 localStorage */
const PREFS_KEY = "yooso.browser.prefs";

export interface BrowserPrefs {
  searchEngine: SearchEngine;
  headHidden: boolean;
}

export function readBrowserPrefs(): BrowserPrefs {
  const fallback: BrowserPrefs = { searchEngine: "bing", headHidden: false };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<BrowserPrefs>;
    return {
      searchEngine: parsed.searchEngine === "baidu" ? "baidu" : "bing",
      headHidden: parsed.headHidden === true,
    };
  } catch {
    return fallback;
  }
}

export function writeBrowserPrefs(prefs: BrowserPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
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
