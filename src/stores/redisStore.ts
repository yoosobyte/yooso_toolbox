import { create } from "zustand";
import {
  redisConfigDelete,
  redisConfigList,
  redisConfigUpsert,
  type RedisConfig,
} from "../modules/redis/api";
import { errText } from "../utils";

interface RedisState {
  connections: RedisConfig[];
  loading: boolean;
  loaded: boolean;
  error?: string;
  load: () => Promise<void>;
  save: (config: RedisConfig) => Promise<RedisConfig[]>;
  remove: (id: string) => Promise<void>;
  markUsed: (id: string) => void;
}

const byCreated = (a: RedisConfig, b: RedisConfig) =>
  (a.createdAt ?? 0) - (b.createdAt ?? 0);

export const useRedisStore = create<RedisState>((set, get) => ({
  connections: [],
  loading: false,
  loaded: false,

  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: undefined });
    try {
      const connections = await redisConfigList();
      set({ connections: connections.sort(byCreated), loading: false, loaded: true });
    } catch (error) {
      set({ loading: false, loaded: true, error: errText(error) });
    }
  },

  save: async (config) => {
    const previous = get().connections;
    const connections = await redisConfigUpsert(config);
    // 后端不保存密码时，本次运行仍用内存里的密码，方便立即连接
    const merged = connections.map((item) => {
      if (item.savePassword) return item;
      const local =
        item.id === config.id ? config : previous.find((entry) => entry.id === item.id);
      if (!local) return item;
      return { ...item, password: local.password };
    });
    const sorted = merged.sort(byCreated);
    set({ connections: sorted });
    return sorted;
  },

  remove: async (id) => {
    const connections = await redisConfigDelete(id);
    set({ connections: connections.sort(byCreated) });
  },

  markUsed: (id) => {
    const now = Math.floor(Date.now() / 1000);
    set((state) => ({
      connections: state.connections.map((item) =>
        item.id === id ? { ...item, lastUsedAt: now } : item,
      ),
    }));
  },
}));
