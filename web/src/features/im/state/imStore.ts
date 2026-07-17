import { create, type StoreApi, type UseBoundStore } from "zustand";

import type { RealtimeStatus } from "@/shared/realtime/realtimeClient";

export const SHOW_MESSAGE_SEQUENCE_NUMBERS_STORAGE_KEY =
  "nano-chat:show-message-sequence-numbers";
export const BROWSER_NOTIFICATIONS_ENABLED_STORAGE_KEY =
  "nano-chat:browser-notifications-enabled";

export type DirectDraft = {
  target_username: string;
  target_user_id?: string;
  target_display_name?: string | null;
};

export type WorkspaceNotice = {
  type: "left_group";
};

export type HistoryBackfillMarker = {
  before_seq: number;
};

export type MobilePanelState = "conversations" | "chat" | "details";
export type FeatureArea = "im";

type ImStoreData = {
  currentFeatureArea: FeatureArea;
  currentConversationId: string | null;
  directDraft: DirectDraft | null;
  workspaceNotice: WorkspaceNotice | null;
  realtimeStatus: RealtimeStatus;
  showMessageSequenceNumbers: boolean;
  browserNotificationsEnabled: boolean;
  unreadCorrections: Record<string, number>;
  unreadCorrectionMaxMessageSeqs: Record<string, number>;
  historyBackfillMarkers: Record<string, HistoryBackfillMarker>;
  mobilePanel: MobilePanelState;
};

type ImStoreActions = {
  setCurrentFeatureArea: (featureArea: FeatureArea) => void;
  setCurrentConversationId: (conversationId: string | null) => void;
  setDirectDraft: (draft: DirectDraft | null) => void;
  setWorkspaceNotice: (notice: WorkspaceNotice | null) => void;
  setRealtimeStatus: (status: RealtimeStatus) => void;
  setShowMessageSequenceNumbers: (show: boolean) => void;
  toggleShowMessageSequenceNumbers: () => void;
  setBrowserNotificationsEnabled: (enabled: boolean) => void;
  incrementUnreadCorrection: (
    conversationId: string,
    amount?: number,
    maxMessageSeq?: number,
  ) => void;
  clearUnreadCorrection: (conversationId: string) => void;
  markHistoryBackfillNeeded: (conversationId: string, beforeSeq: number) => void;
  clearHistoryBackfillMarker: (conversationId: string) => void;
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
  setShowMessageSequenceNumbers(show) {
    writeShowMessageSequenceNumbers(show);
    set({ showMessageSequenceNumbers: show });
  },
  toggleShowMessageSequenceNumbers() {
    set((state) => {
      const showMessageSequenceNumbers = !state.showMessageSequenceNumbers;
      writeShowMessageSequenceNumbers(showMessageSequenceNumbers);
      return { showMessageSequenceNumbers };
    });
  },
  setBrowserNotificationsEnabled(enabled) {
    writeBrowserNotificationsEnabled(enabled);
    set({ browserNotificationsEnabled: enabled });
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
  markHistoryBackfillNeeded(conversationId, beforeSeq) {
    set((state) => ({
      historyBackfillMarkers: {
        ...state.historyBackfillMarkers,
        [conversationId]: { before_seq: beforeSeq },
      },
    }));
  },
  clearHistoryBackfillMarker(conversationId) {
    set((state) => {
      const historyBackfillMarkers = { ...state.historyBackfillMarkers };
      delete historyBackfillMarkers[conversationId];

      return { historyBackfillMarkers };
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
    showMessageSequenceNumbers: readShowMessageSequenceNumbers(),
    browserNotificationsEnabled: readBrowserNotificationsEnabled(),
    unreadCorrections: {},
    unreadCorrectionMaxMessageSeqs: {},
    historyBackfillMarkers: {},
    mobilePanel: "conversations",
  };
}

function readShowMessageSequenceNumbers() {
  try {
    return globalThis.localStorage?.getItem(
      SHOW_MESSAGE_SEQUENCE_NUMBERS_STORAGE_KEY,
    ) === "true";
  } catch {
    return false;
  }
}

function writeShowMessageSequenceNumbers(show: boolean) {
  try {
    globalThis.localStorage?.setItem(
      SHOW_MESSAGE_SEQUENCE_NUMBERS_STORAGE_KEY,
      show ? "true" : "false",
    );
  } catch {
    // Setting persistence is best-effort when storage is unavailable.
  }
}

function readBrowserNotificationsEnabled() {
  try {
    return globalThis.localStorage?.getItem(
      BROWSER_NOTIFICATIONS_ENABLED_STORAGE_KEY,
    ) === "true";
  } catch {
    return false;
  }
}

function writeBrowserNotificationsEnabled(enabled: boolean) {
  try {
    globalThis.localStorage?.setItem(
      BROWSER_NOTIFICATIONS_ENABLED_STORAGE_KEY,
      enabled ? "true" : "false",
    );
  } catch {
    // Setting persistence is best-effort when storage is unavailable.
  }
}
