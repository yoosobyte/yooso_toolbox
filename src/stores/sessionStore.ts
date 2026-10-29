import { create } from "zustand";
import { deleteSession, listSessions, upsertSession } from "../api";
import type { SessionConfig } from "../types";
import { errText } from "../utils";

interface SessionState {
  sessions: SessionConfig[];
  loading: boolean;
  loaded: boolean;
  error?: string;
  load: () => Promise<void>;
  save: (config: SessionConfig) => Promise<SessionConfig[]>;
  remove: (id: string) => Promise<void>;
  /** 仅更新「最近使用时间」，不改变列表顺序 */
  markUsed: (id: string) => void;
}

/** 固定顺序：置顶优先，其次按创建时间。点击会话不会改变顺序 */
const byOrder = (a: SessionConfig, b: SessionConfig) =>
  Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
  (a.createdAt ?? 0) - (b.createdAt ?? 0);

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  loading: false,
  loaded: false,

  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: undefined });
    try {
      const sessions = await listSessions();
      set({ sessions: sessions.sort(byOrder), loading: false, loaded: true });
    } catch (error) {
      set({ loading: false, loaded: true, error: errText(error) });
    }
  },

  save: async (config) => {
    const previous = get().sessions;
    const sessions = await upsertSession(config);
    // 后端在 savePassword=false 时会剔除密码；这里用内存中的值补回来，
    // 保证本次运行期间仍可直接连接（重启后需要重新填写）。
    const merged = sessions.map((item) => {
      if (item.savePassword) return item;
      const local = item.id === config.id ? config : previous.find((x) => x.id === item.id);
      if (!local) return item;
      return { ...item, password: local.password, passphrase: local.passphrase };
    });
    const sorted = merged.sort(byOrder);
    set({ sessions: sorted });
    return sorted;
  },

  remove: async (id) => {
    const sessions = await deleteSession(id);
    set({ sessions: sessions.sort(byOrder) });
  },

  markUsed: (id) => {
    const now = Math.floor(Date.now() / 1000);
    set((state) => ({
      sessions: state.sessions
        .map((item) => (item.id === id ? { ...item, lastUsedAt: now } : item))
        .sort(byOrder),
    }));
  },
}));
