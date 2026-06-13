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

export function useMarkRead({
  conversation,
  highestContiguousSeq,
  isNearBottom,
}: UseMarkReadOptions) {
  const queryClient = useQueryClient();
  const realtimeClient = useRealtimeClient();
  const visibilityState = useDocumentVisibilityState();
  const inFlightReadSeqRef = useRef<Record<string, number>>({});
  const lastSucceededReadSeqRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!conversation || visibilityState !== "visible" || !isNearBottom) {
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
        applyReadResult(queryClient, result);
        useImStore.getState().clearUnreadCorrection(result.conversation_id);
      })
      .catch(() => {
        // Server state remains authoritative for out-of-range or business errors.
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
