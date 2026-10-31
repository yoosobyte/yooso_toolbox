import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  ApiResponse,
  BodyType,
  FileEntry,
  FileRoot,
  HttpMethod,
  IndexStatus,
  MetricsSample,
  ProcessInfo,
  SessionConfig,
  SftpEntry,
  UpdateInfo,
} from "./types";

/* ------------------------------------------------------------------ */
/* 终端会话                                                            */
/* ------------------------------------------------------------------ */

export type SshEvent =
  | { type: "data"; data: string }
  | { type: "connected"; message?: string }
  | { type: "closed"; reason?: string };

export interface ConnectResult {
  sessionId: string;
  serverFingerprint?: string;
  shell?: string;
}

export async function sshConnect(
  config: SessionConfig,
  cols: number,
  rows: number,
  onEvent: (evt: SshEvent) => void,
): Promise<ConnectResult> {
  const channel = new Channel<SshEvent>();
  channel.onmessage = onEvent;
  return invoke<ConnectResult>("ssh_connect", {
    config,
    cols,
    rows,
    onEvent: channel,
  });
}

export const sshWrite = (sessionId: string, data: string) =>
  invoke<void>("ssh_write", { sessionId, data });

export const sshResize = (sessionId: string, cols: number, rows: number) =>
  invoke<void>("ssh_resize", { sessionId, cols, rows });

export const sshDisconnect = (sessionId: string) =>
  invoke<void>("ssh_disconnect", { sessionId });

export interface ProbeResult {
  fingerprint?: string;
  serverVersion?: string;
  authMethod?: string;
}

/** 只握手+认证，不打开 shell，用于表单里的「测试连接」 */
export const sshProbe = (config: SessionConfig) =>
  invoke<ProbeResult>("ssh_probe", { config });

/* ------------------------------------------------------------------ */
/* 会话配置持久化                                                       */
/* ------------------------------------------------------------------ */

export const listSessions = () => invoke<SessionConfig[]>("session_list");

export const upsertSession = (config: SessionConfig) =>
  invoke<SessionConfig[]>("session_upsert", { config });

export const deleteSession = (id: string) =>
  invoke<SessionConfig[]>("session_delete", { id });

export const touchSession = (id: string) =>
  invoke<void>("session_touch", { id }).catch(() => undefined);

/* ------------------------------------------------------------------ */
/* SFTP                                                               */
/* ------------------------------------------------------------------ */

export const sftpHome = (sessionId: string) =>
  invoke<string>("sftp_home", { sessionId });

/** 远端交互式 shell 的当前工作目录（用于跟随终端目录） */
export const shellCwd = (sessionId: string) =>
  invoke<string | null>("ssh_shell_cwd", { sessionId });

/** 远端系统监控采样（CPU / 内存 / 磁盘 / 网卡） */
export const sshMetrics = (sessionId: string) =>
  invoke<MetricsSample>("ssh_metrics", { sessionId });

/** 远端进程列表（按内存倒序，最多 500 条） */
export const sshProcesses = (sessionId: string) =>
  invoke<ProcessInfo[]>("ssh_processes", { sessionId });

/** 结束远端进程（SIGTERM） */
export const sshKillProcess = (sessionId: string, pid: number) =>
  invoke<void>("ssh_kill_process", { sessionId, pid });

export const sftpList = (sessionId: string, path: string) =>
  invoke<SftpEntry[]>("sftp_list", { sessionId, path });

export const sftpMkdir = (sessionId: string, path: string) =>
  invoke<void>("sftp_mkdir", { sessionId, path });

export const sftpRename = (sessionId: string, from: string, to: string) =>
  invoke<void>("sftp_rename", { sessionId, from, to });

export const sftpRemove = (sessionId: string, path: string, isDir: boolean) =>
  invoke<void>("sftp_remove", { sessionId, path, isDir });

export type TransferEvent =
  | { type: "progress"; transferred: number; total: number }
  | { type: "done" }
  | { type: "error"; message: string };

export async function sftpUpload(
  sessionId: string,
  localPath: string,
  remoteDir: string,
  onEvent: (evt: TransferEvent) => void,
): Promise<void> {
  const channel = new Channel<TransferEvent>();
  channel.onmessage = onEvent;
  return invoke<void>("sftp_upload", {
    sessionId,
    localPath,
    remoteDir,
    onEvent: channel,
  });
}

export const sftpCopy = (sessionId: string, from: string, toDir: string) =>
  invoke<void>("sftp_copy", { sessionId, from, toDir });

export async function sftpDownload(
  sessionId: string,
  remotePath: string,
  localPath: string,
  onEvent: (evt: TransferEvent) => void,
): Promise<void> {
  const channel = new Channel<TransferEvent>();
  channel.onmessage = onEvent;
  return invoke<void>("sftp_download", {
    sessionId,
    remotePath,
    localPath,
    onEvent: channel,
  });
}

/** 检查升级：读取远端版本 txt（第一行版本号，第二行安装包直链） */
export const checkUpdate = () => invoke<UpdateInfo>("check_update");
/* ---------------- API 调试 ---------------- */

export interface HttpRequestSpec {
  method: HttpMethod;
  url: string;
  headers: { key: string; value: string }[];
  body?: string;
  bodyType: BodyType;
}

/** 在 Rust 侧发请求，绕开 WebView 的 CORS 限制 */
export const httpRequest = (spec: HttpRequestSpec) =>
  invoke<ApiResponse>("http_request", { spec });

/* ------------------------------------------------------------------ */
/* 文件浏览器                                                          */
/* ------------------------------------------------------------------ */

export const fsRoots = () => invoke<FileRoot[]>("fs_roots");

export const fsList = (dir: string) => invoke<FileEntry[]>("fs_list", { dir });

export const fsSearch = (query: string, scope?: string, limit?: number) =>
  invoke<FileEntry[]>("fs_search", { query, scope: scope || null, limit });

export const fsIndexBuild = () => invoke<void>("fs_index_build");

export const fsIndexStatus = () => invoke<IndexStatus>("fs_index_status");

export const fsDelete = (paths: string[]) => invoke<void>("fs_delete", { paths });

export const fsCopyToClipboard = (paths: string[]) =>
  invoke<void>("fs_copy_to_clipboard", { paths });

export const fsOpenPath = (path: string) => invoke<void>("fs_open_path", { path });

export const fsRevealPath = (path: string) => invoke<void>("fs_reveal_path", { path });

export const fsRename = (path: string, newName: string) =>
  invoke<string>("fs_rename", { path, newName });
/* ------------------------------ 凭据库 ------------------------------ */

export interface VaultStatus {
  configured: boolean;
  unlocked: boolean;
}

export const vaultStatus = () => invoke<VaultStatus>("vault_status");
export const vaultAutoUnlock = () => invoke<void>("vault_auto_unlock");
export const vaultReset = () => invoke<void>("vault_reset");

/* --------------------------- 加密键值（凭据库） --------------------------- */

export const secretGet = (key: string) =>
  invoke<string | null>("secret_get", { key });
export const secretSet = (key: string, value: string) =>
  invoke<void>("secret_set", { key, value });
export const secretDelete = (key: string) =>
  invoke<void>("secret_delete", { key });

/* ------------------------------ 备份 / 恢复 ------------------------------ */

export interface ExportOptions {
  sessions: boolean;
  redis: boolean;
  db: boolean;
  secrets: string[];
  ui: boolean;
}

export const configExport = (
  path: string,
  options: ExportOptions,
  ui: string | null,
) => invoke<void>("config_export", { path, options, ui });

export const configImport = (path: string) =>
  invoke<{ ui: string | null }>("config_import", { path });
