import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { imQueryKeys } from "@/features/im/api/imQueries";
import { useImStore } from "@/features/im/state/imStore";
import type { ConversationSummary } from "@/shared/api/types";
import { useRealtimeClient } from "@/shared/realtime/RealtimeClientContext";
import type { ConversationReadResult } from "@/shared/realtime/protocol";
import { isServerSequenced, type ChatMessage } from "@/shared/utils/message";

type UseMarkReadOptions = {
  conversation: ConversationSummary | null | undefined;
  messages: ChatMessage[];
  isNearBottom: boolean;
};

export function useMarkRead({
  conversation,
  messages,
  isNearBottom,
}: UseMarkReadOptions) {
  const queryClient = useQueryClient();
  const realtimeClient = useRealtimeClient();
  const visibilityState = useDocumentVisibilityState();
  const lastRequestedReadSeqRef = useRef<Record<string, number>>({});
  const highestContiguousSeq = useMemo(
    () => getHighestContiguousSeqAfter(conversation?.read_seq ?? 0, messages),
    [conversation?.read_seq, messages],
  );

  useEffect(() => {
    if (!conversation || visibilityState !== "visible" || !isNearBottom) {
      return;
    }

    if (highestContiguousSeq <= conversation.read_seq) {
      return;
    }

    if (
      lastRequestedReadSeqRef.current[conversation.conversation_id] >=
      highestContiguousSeq
    ) {
      return;
    }

    lastRequestedReadSeqRef.current[conversation.conversation_id] =
      highestContiguousSeq;

    void realtimeClient
      .sendCommand<"conversation.read", ConversationReadResult>(
        "conversation.read",
        {
          conversation_id: conversation.conversation_id,
          read_seq: highestContiguousSeq,
        },
      )
      .then((result) => {
        applyReadResult(queryClient, result);
        useImStore.getState().clearUnreadCorrection(result.conversation_id);
      })
      .catch(() => {
        // Server state remains authoritative for out-of-range or business errors.
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

function getHighestContiguousSeqAfter(
  readSeq: number,
  messages: ChatMessage[],
) {
  const seqs = new Set(
    messages.filter(isServerSequenced).map((message) => message.message_seq),
  );
  let highestContiguousSeq = readSeq;

  while (seqs.has(highestContiguousSeq + 1)) {
    highestContiguousSeq += 1;
  }

  return highestContiguousSeq;
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
