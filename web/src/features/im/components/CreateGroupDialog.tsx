import { X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { useApiClient, useSession } from "@/app/AppProviders";
import { imQueryKeys } from "@/features/im/api/imQueries";
import { useImStore } from "@/features/im/state/imStore";
import { ApiError } from "@/shared/api/client";
import type { ConversationSummary, UserSummary } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

export type CreateGroupDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CreateGroupDialog({
  open,
  onOpenChange,
}: CreateGroupDialogProps) {
  const { t } = useTranslation();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { session } = useSession();
  const setCurrentConversationId = useImStore(
    (state) => state.setCurrentConversationId,
  );
  const setDirectDraft = useImStore((state) => state.setDirectDraft);
  const setMobilePanel = useImStore((state) => state.setMobilePanel);
  const setWorkspaceNotice = useImStore((state) => state.setWorkspaceNotice);
  const [name, setName] = useState("");
  const [memberUsername, setMemberUsername] = useState("");
  const [members, setMembers] = useState<UserSummary[]>([]);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isLookingUpMember, setIsLookingUpMember] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const trimmedName = name.trim();
  const canSubmit = useMemo(
    () => trimmedName.length > 0 && members.length > 0 && !isCreating,
    [isCreating, members.length, trimmedName.length],
  );

  function resetDialogState() {
    setName("");
    setMemberUsername("");
    setMembers([]);
    setMemberError(null);
    setSubmitError(null);
    setIsLookingUpMember(false);
    setIsCreating(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetDialogState();
    }

    onOpenChange(nextOpen);
  }

  async function lookupMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const exactUsername = memberUsername.trim();

    if (!exactUsername) {
      setMemberError(t("im.validation.exactUsernameRequired"));
      return;
    }

    setIsLookingUpMember(true);
    setMemberError(null);

    try {
      const user = await apiClient.lookupUser(exactUsername);

      if (user.user_id === session?.user.user_id) {
        setMemberError(t("im.group.selfMemberNotAllowed"));
        return;
      }

      if (members.some((member) => member.user_id === user.user_id)) {
        setMemberError(t("im.group.memberAlreadySelected"));
        return;
      }

      setMembers((currentMembers) => [...currentMembers, user]);
      setMemberUsername("");
    } catch (error) {
      setMemberError(toLookupErrorMessage(error, t));
    } finally {
      setIsLookingUpMember(false);
    }
  }

  async function submitGroupCreation() {
    if (!canSubmit) {
      return;
    }

    setIsCreating(true);
    setSubmitError(null);

    try {
      const createdConversation = await apiClient.createGroup({
        name: trimmedName,
        member_ids: members.map((member) => member.user_id),
      });

      seedCreatedConversation(queryClient, createdConversation);
      await queryClient.invalidateQueries({
        queryKey: imQueryKeys.conversations(),
      });
      setDirectDraft(null);
      setWorkspaceNotice(null);
      setCurrentConversationId(createdConversation.conversation_id);
      setMobilePanel("chat");
      navigate(
        `/app/im/conversations/${encodeURIComponent(
          createdConversation.conversation_id,
        )}`,
      );
      handleOpenChange(false);
    } catch {
      setSubmitError(t("im.group.createError"));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("im.group.createTitle")}</DialogTitle>
          <DialogDescription>{t("im.group.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submitGroupCreation();
            }}
          >
            <label
              className="text-sm font-bold text-[var(--foreground)]"
              htmlFor="create-group-name"
            >
              {t("im.group.nameLabel")}
            </label>
            <Input
              id="create-group-name"
              onChange={(event) => {
                setName(event.target.value);
                if (submitError) {
                  setSubmitError(null);
                }
              }}
              placeholder={t("im.group.namePlaceholder")}
              value={name}
            />
            <div className="flex flex-wrap gap-2 text-xs font-semibold text-[var(--muted-foreground)]">
              <span>{t("im.group.nameRequired")}</span>
              <span aria-hidden="true">·</span>
              <span>{t("im.group.memberRequired")}</span>
            </div>
          </form>

          <form className="space-y-3" onSubmit={lookupMember}>
            <label
              className="text-sm font-bold text-[var(--foreground)]"
              htmlFor="create-group-member-username"
            >
              {t("im.group.memberUsernameLabel")}
            </label>
            <div className="flex gap-2">
              <Input
                autoComplete="off"
                id="create-group-member-username"
                onChange={(event) => {
                  setMemberUsername(event.target.value);
                  if (memberError) {
                    setMemberError(null);
                  }
                }}
                placeholder={t("im.newDirect.usernamePlaceholder")}
                value={memberUsername}
              />
              <Button
                disabled={isLookingUpMember}
                type="submit"
                variant="secondary"
              >
                {t("im.group.addMember")}
              </Button>
            </div>
            {memberError ? (
              <p
                className="rounded-[var(--radius)] border border-[color-mix(in_oklab,var(--destructive)_28%,white)] bg-[color-mix(in_oklab,var(--destructive)_8%,white)] px-3 py-2 text-sm font-semibold text-[var(--destructive)]"
                role="alert"
              >
                {memberError}
              </p>
            ) : null}
          </form>

          <div className="space-y-2">
            <p className="text-sm font-bold text-[var(--foreground)]">
              {t("im.group.selectedMembers")}
            </p>
            {members.length === 0 ? (
              <p className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-white/54 px-3 py-2 text-sm font-semibold text-[var(--muted-foreground)]">
                {t("im.group.noSelectedMembers")}
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {members.map((member) => (
                  <li key={member.user_id}>
                    <MemberChip
                      member={member}
                      onRemove={() => {
                        setMembers((currentMembers) =>
                          currentMembers.filter(
                            (candidate) => candidate.user_id !== member.user_id,
                          ),
                        );
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {submitError ? (
            <p
              className="rounded-[var(--radius)] border border-[color-mix(in_oklab,var(--destructive)_28%,white)] bg-[color-mix(in_oklab,var(--destructive)_8%,white)] px-3 py-2 text-sm font-semibold text-[var(--destructive)]"
              role="alert"
            >
              {submitError}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              disabled={isCreating}
              onClick={() => handleOpenChange(false)}
              type="button"
              variant="secondary"
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!canSubmit}
              onClick={() => {
                void submitGroupCreation();
              }}
              type="button"
            >
              {t("im.group.submit")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MemberChip({
  member,
  onRemove,
}: {
  member: UserSummary;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const displayName = displayUserName(member);

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/76 px-3 py-1.5 text-sm font-bold text-[var(--foreground)] shadow-sm">
      <span>{displayName}</span>
      <span className="text-xs font-semibold text-[var(--muted-foreground)]">
        @{member.username}
      </span>
      <button
        aria-label={t("im.group.removeMember", { username: member.username })}
        className="rounded-full p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
        onClick={onRemove}
        type="button"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </span>
  );
}

function seedCreatedConversation(
  queryClient: ReturnType<typeof useQueryClient>,
  conversation: ConversationSummary,
) {
  queryClient.setQueryData<ConversationSummary[]>(
    imQueryKeys.conversations(),
    (conversations = []) => [
      conversation,
      ...conversations.filter(
        (candidate) => candidate.conversation_id !== conversation.conversation_id,
      ),
    ],
  );
}

function toLookupErrorMessage(
  error: unknown,
  t: (key: string) => string,
) {
  if (error instanceof ApiError && error.code === "user_not_found") {
    return t("im.validation.userNotFound");
  }

  return t("im.group.lookupError");
}

function displayUserName(user: UserSummary) {
  return user.display_name?.trim() || user.username;
}
