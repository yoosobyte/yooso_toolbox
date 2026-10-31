import { create } from "zustand";
import type { HistoryEntry, SavedRequest } from "../types";

import { loadStored, migrateStored, saveStored } from "../storage";

const KEY = "api.state";
const LEGACY_KEY = "yooso.api";

interface Persisted {
  saved: SavedRequest[];
  history: HistoryEntry[];
}

/** 从加密凭据库读取收藏与历史（首次启动会把旧的 localStorage 数据迁过来） */
async function read(): Promise<Persisted> {
  await migrateStored(LEGACY_KEY, KEY);
  const raw = await loadStored(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      return {
        saved: parsed.saved ?? [],
        history: parsed.history ?? [],
      };
    } catch {
      /* 忽略损坏的数据 */
    }
  }
  return { saved: [], history: [] };
}

const MAX_HISTORY = 60;

interface ApiState extends Persisted {
  init: () => Promise<void>;
  saveRequest: (saved: SavedRequest) => void;
  removeRequest: (id: string) => void;
  pushHistory: (entry: Omit<HistoryEntry, "id" | "at">) => void;
  clearHistory: () => void;
}

export const useApiStore = create<ApiState>((set, get) => {
  const persist = (patch: Partial<Persisted>) => {
    const { saved, history } = get();
    void saveStored(
      KEY,
      JSON.stringify({
        saved: patch.saved ?? saved,
        history: patch.history ?? history,
      } satisfies Persisted),
    );
  };

  return {
    saved: [],
    history: [],

    init: async () => {
      const data = await read();
      set({ saved: data.saved, history: data.history });
    },

    saveRequest: (saved) => {
      const exists = get().saved.some((item) => item.id === saved.id);
      const list = exists
        ? get().saved.map((item) => (item.id === saved.id ? saved : item))
        : [saved, ...get().saved];
      set({ saved: list });
      persist({ saved: list });
    },

    removeRequest: (id) => {
      const list = get().saved.filter((item) => item.id !== id);
      set({ saved: list });
      persist({ saved: list });
    },

    pushHistory: (entry) => {
      const next: HistoryEntry = { ...entry, id: crypto.randomUUID(), at: Date.now() };
      const list = [next, ...get().history].slice(0, MAX_HISTORY);
      set({ history: list });
      persist({ history: list });
    },

    clearHistory: () => {
      set({ history: [] });
      persist({ history: [] });
    },
  };
});
