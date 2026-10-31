export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  history: string[];
  historyIndex: number;
  /** 站点自定义的 favicon 地址 */
  icon?: string;
}
