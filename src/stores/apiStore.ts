import { create } from "zustand";
import type { HistoryEntry, SavedRequest } from "../types";

const KEY = "yooso.api";

interface Persisted {
  saved: SavedRequest[];
  history: HistoryEntry[];
}

function read(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      return {
        saved: parsed.saved ?? [],
        history: parsed.history ?? [],
      };
    }
  } catch {
    /* 忽略损坏的本地配置 */
  }
  return { saved: [], history: [] };
}

const MAX_HISTORY = 60;

interface ApiState extends Persisted {
  saveRequest: (saved: SavedRequest) => void;
  removeRequest: (id: string) => void;
  pushHistory: (entry: Omit<HistoryEntry, "id" | "at">) => void;
  clearHistory: () => void;
}

const initial = read();

export const useApiStore = create<ApiState>((set, get) => {
  const persist = (patch: Partial<Persisted>) => {
    const { saved, history } = get();
    localStorage.setItem(
      KEY,
      JSON.stringify({
        saved: patch.saved ?? saved,
        history: patch.history ?? history,
      } satisfies Persisted),
    );
  };

  return {
    ...initial,

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
