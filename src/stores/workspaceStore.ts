import { create } from "zustand";
import { touchSession } from "../api";
import type { SessionConfig, TabStatus, TermTab } from "../types";
import { SESSION_COLORS } from "../utils";

let tabSeq = 0;

const nextColor = (index: number) => SESSION_COLORS[index % SESSION_COLORS.length];

interface WorkspaceState {
  tabs: TermTab[];
  activeId: string | null;
  openTab: (config: SessionConfig) => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  patchTab: (id: string, patch: Partial<TermTab>) => void;
  setStatus: (id: string, status: TabStatus, error?: string) => void;
  toggleSftp: (id: string) => void;
  reconnect: (id: string) => void;
  closeAll: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  tabs: [],
  activeId: null,

  openTab: (config) => {
    const existing = get().tabs.find((tab) => tab.configId === config.id);
    if (existing) {
      // 同一会话只保留一个标签页；如果已经掉线则直接重连
      if (existing.status === "closed" || existing.status === "error") {
        get().reconnect(existing.id);
      }
      set({ activeId: existing.id });
      return;
    }

    tabSeq += 1;
    const id = `tab-${Date.now().toString(36)}-${tabSeq}`;
    const tab: TermTab = {
      id,
      configId: config.id,
      title: config.name || config.host,
      subtitle: `${config.username}@${config.host}:${config.port}`,
      color: config.color || nextColor(tabSeq),
      status: "connecting",
      sftpOpen: false,
      attempt: 0,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    void touchSession(config.id);
  },

  closeTab: (id) => {
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id);
      if (index < 0) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      let activeId = state.activeId;
      if (activeId === id) {
        const next = tabs[index] ?? tabs[index - 1] ?? null;
        activeId = next ? next.id : null;
      }
      return { tabs, activeId };
    });
  },

  setActive: (id) => set({ activeId: id }),

  patchTab: (id, patch) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)),
    })),

  setStatus: (id, status, error) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, status, error: status === "error" ? error : undefined } : tab,
      ),
    })),

  toggleSftp: (id) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, sftpOpen: !tab.sftpOpen } : tab,
      ),
    })),

  reconnect: (id) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? { ...tab, status: "connecting", error: undefined, attempt: tab.attempt + 1 }
          : tab,
      ),
    })),

  closeAll: () => set({ tabs: [], activeId: null }),
}));
