import { create, type StoreApi, type UseBoundStore } from "zustand";

import type { RealtimeStatus } from "@/shared/realtime/realtimeClient";

export type DirectDraft = {
  target_username: string;
  target_user_id?: string;
  target_display_name?: string | null;
};

export type WorkspaceNotice = {
  type: "left_group";
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
  workspaceNotice: WorkspaceNotice | null;
  realtimeStatus: RealtimeStatus;
  unreadCorrections: Record<string, number>;
  unreadCorrectionMaxMessageSeqs: Record<string, number>;
  historySyncMarkers: Record<string, HistorySyncMarker>;
  mobilePanel: MobilePanelState;
};

type ImStoreActions = {
  setCurrentFeatureArea: (featureArea: FeatureArea) => void;
  setCurrentConversationId: (conversationId: string | null) => void;
  setDirectDraft: (draft: DirectDraft | null) => void;
  setWorkspaceNotice: (notice: WorkspaceNotice | null) => void;
  setRealtimeStatus: (status: RealtimeStatus) => void;
  incrementUnreadCorrection: (
    conversationId: string,
    amount?: number,
    maxMessageSeq?: number,
  ) => void;
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
  setWorkspaceNotice(notice) {
    set({ workspaceNotice: notice });
  },
  setRealtimeStatus(status) {
    set({ realtimeStatus: status });
  },
  incrementUnreadCorrection(conversationId, amount = 1, maxMessageSeq) {
    set((state) => {
      const unreadCorrectionMaxMessageSeqs = {
        ...state.unreadCorrectionMaxMessageSeqs,
      };

      if (maxMessageSeq !== undefined) {
        unreadCorrectionMaxMessageSeqs[conversationId] = Math.max(
          state.unreadCorrectionMaxMessageSeqs[conversationId] ?? 0,
          maxMessageSeq,
        );
      }

      return {
        unreadCorrections: {
          ...state.unreadCorrections,
          [conversationId]:
            (state.unreadCorrections[conversationId] ?? 0) + amount,
        },
        unreadCorrectionMaxMessageSeqs,
      };
    });
  },
  clearUnreadCorrection(conversationId) {
    set((state) => {
      const unreadCorrections = { ...state.unreadCorrections };
      const unreadCorrectionMaxMessageSeqs = {
        ...state.unreadCorrectionMaxMessageSeqs,
      };
      delete unreadCorrections[conversationId];
      delete unreadCorrectionMaxMessageSeqs[conversationId];

      return { unreadCorrections, unreadCorrectionMaxMessageSeqs };
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
    workspaceNotice: null,
    realtimeStatus: "idle",
    unreadCorrections: {},
    unreadCorrectionMaxMessageSeqs: {},
    historySyncMarkers: {},
    mobilePanel: "conversations",
  };
}
