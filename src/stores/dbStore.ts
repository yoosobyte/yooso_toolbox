import { create } from "zustand";
import { dbConfigDelete, dbConfigList, dbConfigUpsert, type DbConfig } from "../modules/db/api";
import { errText } from "../utils";

interface DbState {
  connections: DbConfig[];
  loading: boolean;
  loaded: boolean;
  error?: string;
  load: () => Promise<void>;
  save: (config: DbConfig) => Promise<DbConfig[]>;
  remove: (id: string) => Promise<void>;
  markUsed: (id: string) => void;
}

const byCreated = (a: DbConfig, b: DbConfig) =>
  (a.createdAt ?? 0) - (b.createdAt ?? 0);

export const useDbStore = create<DbState>((set, get) => ({
  connections: [],
  loading: false,
  loaded: false,

  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: undefined });
    try {
      const connections = await dbConfigList();
      set({ connections: connections.sort(byCreated), loading: false, loaded: true });
    } catch (error) {
      set({ loading: false, loaded: true, error: errText(error) });
    }
  },

  save: async (config) => {
    const previous = get().connections;
    const connections = await dbConfigUpsert(config);
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
    const connections = await dbConfigDelete(id);
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
