import { secretDelete, secretGet, secretSet } from "./api";
import { inTauri } from "./save";

/** 浏览器调试时的回退前缀（桌面端走加密凭据库） */
const LOCAL_PREFIX = "yooso.enc.";

async function readLocal(key: string): Promise<string | null> {
  try {
    return localStorage.getItem(LOCAL_PREFIX + key);
  } catch {
    return null;
  }
}

/** 读取一份持久化数据：优先加密凭据库，浏览器调试时退回 localStorage */
export async function loadStored(key: string): Promise<string | null> {
  if (inTauri()) {
    try {
      const value = await secretGet(key);
      if (value !== null) return value;
    } catch {
      /* 凭据库不可用时退回本地 */
    }
  }
  return readLocal(key);
}

/** 写入一份持久化数据：桌面端加密保存，浏览器调试时存 localStorage */
export async function saveStored(key: string, value: string): Promise<void> {
  if (inTauri()) {
    try {
      await secretSet(key, value);
      return;
    } catch {
      /* 凭据库不可用时退回本地 */
    }
  }
  try {
    localStorage.setItem(LOCAL_PREFIX + key, value);
  } catch {
    /* 忽略配额错误 */
  }
}

export async function removeStored(key: string): Promise<void> {
  if (inTauri()) {
    try {
      await secretDelete(key);
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.removeItem(LOCAL_PREFIX + key);
  } catch {
    /* ignore */
  }
}

const MIGRATED_PREFIX = "migrated.";

/** 把旧版明文 localStorage 数据迁移到加密存储，成功后删除旧 key */
export async function migrateStored(
  legacyKey: string,
  key: string,
): Promise<void> {
  try {
    const done = await loadStored(MIGRATED_PREFIX + key);
    const legacy = localStorage.getItem(legacyKey);
    if (done === "1") {
      // 已迁移过：只补删旧 key，绝不用旧值覆盖后端数据
      if (legacy) localStorage.removeItem(legacyKey);
      return;
    }
    if (!legacy) return;
    await saveStored(key, legacy);
    await saveStored(MIGRATED_PREFIX + key, "1");
    localStorage.removeItem(legacyKey);
  } catch {
    /* 迁移失败时保留旧数据，下次再试 */
  }
}

/** 已知的旧 localStorage key → 后端 key（启动时清理用） */
export const LEGACY_KEY_MAP: Record<string, string> = {
  "yooso.notes.v1": "notes",
  "yooso.browser.sites.v1": "browser.sites",
  "yooso.toolbox.db.queries.v1": "db.queries",
  "yooso.api": "api.state",
  "yooso.ai.settings.v1": "ai.settings",
  "yooso.translate.line": "translate.line",
  "yooso.translate.direction": "translate.direction",
  "yooso.redis.keyView": "redis.keyView",
  "yooso.sftpHeight": "sftp.height",
  "yooso.sftpFollowCwd": "sftp.follow",
};

/** 后端已有数据时，删掉对应的旧 localStorage key（删不掉也不影响使用） */
export async function cleanupLegacyKeys(): Promise<void> {
  for (const [legacy, secret] of Object.entries(LEGACY_KEY_MAP)) {
    try {
      const stored = await loadStored(secret);
      if (stored !== null) localStorage.removeItem(legacy);
    } catch {
      /* ignore */
    }
  }
  // 这些旧侧栏宽度已经没有任何代码使用
  for (const key of [
    "api.sideWidth",
    "db.sideWidth",
    "note.sideWidth",
    "qr.sideWidth",
    "redis.sideWidth",
    "translate.sideWidth",
  ]) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
