import { loadStored, migrateStored, saveStored } from "../../storage";

export interface BrowserSite {
  id: string;
  name: string;
  url: string;
  /** 打开浏览器模块时自动以 tab 打开 */
  autoOpen: boolean;
  color: string;
  /** 站点的 favicon 地址（可在「修改」里指定，留空则自动探测） */
  icon?: string;
}

const SECRET_KEY = "browser.sites";
const LEGACY_KEY = "yooso.browser.sites.v1";

const DEFAULT_SITES: BrowserSite[] = [
  {
    id: "doubao",
    name: "豆包",
    url: "https://www.doubao.com",
    color: "#6b5cff",
    autoOpen: false,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    url: "https://chat.deepseek.com",
    color: "#4d6bfe",
    autoOpen: false,
  },
];


const LEGACY_IDS = new Set([
  "bing",
  "baidu",
  "mdn",
  "tauri",
  "vite",
  "rust",
  "github",
  "stackoverflow",
]);

function normalizeSite(raw: unknown): BrowserSite | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" && value.id ? value.id : crypto.randomUUID();
  const name = typeof value.name === "string" ? value.name : "";
  const url = typeof value.url === "string" ? value.url : "";
  if (!name || !url) return null;
  return {
    id,
    name,
    url,
    color: typeof value.color === "string" && value.color ? value.color : "#3b82f6",
    autoOpen: value.autoOpen === true,
    icon: typeof value.icon === "string" && value.icon ? value.icon : undefined,
  };
}

export async function loadSites(): Promise<BrowserSite[]> {
  await migrateStored(LEGACY_KEY, SECRET_KEY);
  const raw = await loadStored(SECRET_KEY);
  try {
    if (!raw) return DEFAULT_SITES.map((site) => ({ ...site }));
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_SITES.map((site) => ({ ...site }));
    const sites = parsed
      .map(normalizeSite)
      .filter((site): site is BrowserSite => site !== null);
    if (sites.length === 0) return DEFAULT_SITES.map((site) => ({ ...site }));
    // 存储里还是旧的内置站点，说明用户没改过，换成新的默认列表
    if (sites.every((site) => LEGACY_IDS.has(site.id))) {
      return DEFAULT_SITES.map((site) => ({ ...site }));
    }
    return sites;
  } catch {
    return DEFAULT_SITES.map((site) => ({ ...site }));
  }
}

export async function saveSites(sites: BrowserSite[]): Promise<void> {
  await saveStored(SECRET_KEY, JSON.stringify(sites));
}
