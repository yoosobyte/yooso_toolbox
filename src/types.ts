export type AuthType = "password" | "key";

/** 一个 SSH 会话配置（持久化在本地配置文件中） */
export interface SessionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  /** 主题色，用于会话列表的标识点 */
  color?: string;
  savePassword?: boolean;
  /** 置顶显示 */
  pinned?: boolean;
  lastUsedAt?: number;
  createdAt?: number;
}

export type TabStatus = "connecting" | "connected" | "closed" | "error";

/** 一个已打开的终端标签页 */
export interface TermTab {
  id: string;
  configId: string;
  title: string;
  subtitle: string;
  color: string;
  status: TabStatus;
  error?: string;
  sftpOpen: boolean;
  /** 每次重连自增，用于强制重建终端组件 */
  attempt: number;
}

export interface SftpEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  /** 秒级时间戳 */
  modified?: number;
  permissions?: string;
}

export interface TransferItem {
  id: string;
  name: string;
  direction: "upload" | "download";
  percent: number;
  status: "running" | "done" | "error";
  message?: string;
}

/** 远端系统监控采样（字节为单位） */
export interface MetricsSample {
  /** CPU 总占用百分比 0-100 */
  cpuTotal: number;
  /** 每个逻辑核心的占用百分比 */
  cpuCores: number[];
  memTotal: number;
  memUsed: number;
  diskTotal: number;
  diskUsed: number;
  /** 开机以来累计收发字节数，前端据此算速率 */
  netRx: number;
  netTx: number;
}

/** 远端单个进程 */
export interface ProcessInfo {
  pid: number;
  /** 进程名（comm） */
  name: string;
  /** CPU 占用百分比 */
  cpu: number;
  /** 常驻内存字节数 */
  rss: number;
  /** 启动时间（Unix 秒，0 表示未知） */
  started: number;
  /** 启动命令行 */
  command: string;
}

/** 升级检查结果 */
export interface UpdateInfo {
  current: string;
  latest: string;
  /** 当前平台安装包直链（update.json 的 mac / win 字段） */
  url: string;
  hasUpdate: boolean;
  /** 更新说明（update.json 的 desc 字段，换行已归一化） */
  notes: string;
}
/* ---------------- API 调试 ---------------- */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type BodyType = "none" | "json" | "text" | "form";

/** 键值行（参数 / 请求头） */
export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}


/** 一个请求的全部可编辑状态 */
export interface ApiRequest {
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  bodyType: BodyType;
  body: string;
}

/** 已保存的请求 */
export interface SavedRequest {
  id: string;
  name: string;
  request: ApiRequest;
}

/** 历史记录 */
export interface HistoryEntry {
  id: string;
  method: HttpMethod;
  url: string;
  status: number;
  timeMs: number;
  at: number;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: { key: string; value: string }[];
  body: string;
  timeMs: number;
  size: number;
  truncated: boolean;
}

/* ---------------- 文件浏览器 ---------------- */

/** 文件 / 目录条目 */
export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  /** 秒级时间戳 */
  modified: number | null;
}

/** 文件模块左侧的根目录（个人目录 / 下载 / 桌面…） */
export interface FileRoot {
  key: string;
  name: string;
  path: string;
}