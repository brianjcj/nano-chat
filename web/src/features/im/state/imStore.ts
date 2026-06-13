import { create, type StoreApi, type UseBoundStore } from "zustand";

import type { RealtimeStatus } from "@/shared/realtime/realtimeClient";

export type DirectDraft = {
  target_username?: string;
  target_user_id?: string;
  body: string;
};

export type HistorySyncMarker = {
  after_seq: number;
};

export type MobilePanelState = "conversations" | "chat" | "details";
export type FeatureArea = "im";

type ImStoreData = {
  currentFeatureArea: FeatureArea;
  currentConversationId: string | null;
  directDraft: DirectDraft | null;
  realtimeStatus: RealtimeStatus;
  unreadCorrections: Record<string, number>;
  historySyncMarkers: Record<string, HistorySyncMarker>;
  mobilePanel: MobilePanelState;
};

type ImStoreActions = {
  setCurrentFeatureArea: (featureArea: FeatureArea) => void;
  setCurrentConversationId: (conversationId: string | null) => void;
  setDirectDraft: (draft: DirectDraft | null) => void;
  setRealtimeStatus: (status: RealtimeStatus) => void;
  incrementUnreadCorrection: (conversationId: string, amount?: number) => void;
  clearUnreadCorrection: (conversationId: string) => void;
  markHistorySyncNeeded: (conversationId: string, afterSeq: number) => void;
  clearHistorySyncMarker: (conversationId: string) => void;
  setMobilePanel: (panel: MobilePanelState) => void;
  reset: () => void;
};

export type ImStoreState = ImStoreData & ImStoreActions;
export type ImStoreApi = UseBoundStore<StoreApi<ImStoreState>>;

export const useImStore = create<ImStoreState>((set) => ({
  ...createInitialImStoreData(),
  setCurrentFeatureArea(featureArea) {
    set({ currentFeatureArea: featureArea });
  },
  setCurrentConversationId(conversationId) {
    set({ currentConversationId: conversationId });
  },
  setDirectDraft(draft) {
    set({ directDraft: draft });
  },
  setRealtimeStatus(status) {
    set({ realtimeStatus: status });
  },
  incrementUnreadCorrection(conversationId, amount = 1) {
    set((state) => ({
      unreadCorrections: {
        ...state.unreadCorrections,
        [conversationId]:
          (state.unreadCorrections[conversationId] ?? 0) + amount,
      },
    }));
  },
  clearUnreadCorrection(conversationId) {
    set((state) => {
      const unreadCorrections = { ...state.unreadCorrections };
      delete unreadCorrections[conversationId];

      return { unreadCorrections };
    });
  },
  markHistorySyncNeeded(conversationId, afterSeq) {
    set((state) => ({
      historySyncMarkers: {
        ...state.historySyncMarkers,
        [conversationId]: { after_seq: afterSeq },
      },
    }));
  },
  clearHistorySyncMarker(conversationId) {
    set((state) => {
      const historySyncMarkers = { ...state.historySyncMarkers };
      delete historySyncMarkers[conversationId];

      return { historySyncMarkers };
    });
  },
  setMobilePanel(panel) {
    set({ mobilePanel: panel });
  },
  reset() {
    set(createInitialImStoreData());
  },
}));

export function createInitialImStoreData(): ImStoreData {
  return {
    currentFeatureArea: "im",
    currentConversationId: null,
    directDraft: null,
    realtimeStatus: "idle",
    unreadCorrections: {},
    historySyncMarkers: {},
    mobilePanel: "conversations",
  };
}
