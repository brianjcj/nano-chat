import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { imQueryKeys } from "@/features/im/api/imQueries";
import { useImStore } from "@/features/im/state/imStore";
import type { ConversationSummary } from "@/shared/api/types";
import { useRealtimeClient } from "@/shared/realtime/RealtimeClientContext";
import type { ConversationReadResult } from "@/shared/realtime/protocol";

type UseMarkReadOptions = {
  conversation: ConversationSummary | null | undefined;
  highestContiguousSeq: number;
  isNearBottom: boolean;
};

type ReadRetryState = {
  failedAttempts: number;
  seq: number;
};

const READ_RETRY_DELAY_MS = 100;
const MAX_READ_RETRY_TICKS = 3;

export function useMarkRead({
  conversation,
  highestContiguousSeq,
  isNearBottom,
}: UseMarkReadOptions) {
  const queryClient = useQueryClient();
  const realtimeClient = useRealtimeClient();
  const realtimeStatus = useImStore((state) => state.realtimeStatus);
  const visibilityState = useDocumentVisibilityState();
  const inFlightReadSeqRef = useRef<Record<string, number>>({});
  const lastSucceededReadSeqRef = useRef<Record<string, number>>({});
  const retryStateRef = useRef<Record<string, ReadRetryState>>({});
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!conversation || visibilityState !== "visible" || !isNearBottom) {
      return;
    }

    if (realtimeStatus !== "connected") {
      return;
    }

    if (highestContiguousSeq <= conversation.read_seq) {
      return;
    }

    const conversationId = conversation.conversation_id;
    const lastSucceededReadSeq = Math.max(
      lastSucceededReadSeqRef.current[conversationId] ?? 0,
      conversation.read_seq,
    );

    if (lastSucceededReadSeq >= highestContiguousSeq) {
      return;
    }

    if (inFlightReadSeqRef.current[conversationId] >= highestContiguousSeq) {
      return;
    }

    inFlightReadSeqRef.current[conversationId] = highestContiguousSeq;

    void realtimeClient
      .sendCommand<"conversation.read", ConversationReadResult>(
        "conversation.read",
        {
          conversation_id: conversationId,
          read_seq: highestContiguousSeq,
        },
      )
      .then((result) => {
        lastSucceededReadSeqRef.current[result.conversation_id] = Math.max(
          lastSucceededReadSeqRef.current[result.conversation_id] ?? 0,
          result.read_seq,
        );
        delete retryStateRef.current[result.conversation_id];
        applyReadResult(queryClient, result);
        useImStore.getState().clearUnreadCorrection(result.conversation_id);
      })
      .catch(() => {
        if (inFlightReadSeqRef.current[conversationId] === highestContiguousSeq) {
          delete inFlightReadSeqRef.current[conversationId];
        }

        if (useImStore.getState().realtimeStatus !== "connected") {
          return;
        }

        const currentRetryState = retryStateRef.current[conversationId];
        const failedAttempts =
          currentRetryState?.seq === highestContiguousSeq
            ? currentRetryState.failedAttempts + 1
            : 1;

        retryStateRef.current[conversationId] = {
          failedAttempts,
          seq: highestContiguousSeq,
        };

        if (
          failedAttempts <= MAX_READ_RETRY_TICKS &&
          retryTimerRef.current === null
        ) {
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            setRetryTick((tick) => tick + 1);
          }, READ_RETRY_DELAY_MS);
        }
      })
      .finally(() => {
        if (inFlightReadSeqRef.current[conversationId] === highestContiguousSeq) {
          delete inFlightReadSeqRef.current[conversationId];
        }
      });
  }, [
    conversation,
    highestContiguousSeq,
    isNearBottom,
    queryClient,
    realtimeClient,
    realtimeStatus,
    retryTick,
    visibilityState,
  ]);

  return { highestContiguousSeq };
}

function useDocumentVisibilityState() {
  const [visibilityState, setVisibilityState] = useState<DocumentVisibilityState>(
    () => document.visibilityState,
  );

  useEffect(() => {
    function updateVisibilityState() {
      setVisibilityState(document.visibilityState);
    }

    document.addEventListener("visibilitychange", updateVisibilityState);

    return () => {
      document.removeEventListener("visibilitychange", updateVisibilityState);
    };
  }, []);

  return visibilityState;
}

function applyReadResult(
  queryClient: ReturnType<typeof useQueryClient>,
  result: ConversationReadResult,
) {
  queryClient.setQueryData<ConversationSummary[]>(
    imQueryKeys.conversations(),
    (conversations) =>
      conversations?.map((conversation) => {
        if (conversation.conversation_id !== result.conversation_id) {
          return conversation;
        }

        const readSeq = Math.max(conversation.read_seq, result.read_seq);

        return {
          ...conversation,
          read_seq: readSeq,
          unread_count: Math.max(0, conversation.latest_message_seq - readSeq),
        };
      }),
  );
}
