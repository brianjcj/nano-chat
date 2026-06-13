import { UserPlus, UsersRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { useApiClient } from "@/app/AppProviders";
import { imQueryKeys, useMembersQuery } from "@/features/im/api/imQueries";
import { useImStore } from "@/features/im/state/imStore";
import { ApiError } from "@/shared/api/client";
import type {
  ConversationMember,
  ConversationSummary,
  UserSummary,
} from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";

export type MemberPanelProps = {
  conversation: ConversationSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MemberPanel({
  conversation,
  open,
  onOpenChange,
}: MemberPanelProps) {
  const { t } = useTranslation();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const membersQuery = useMembersQuery(conversation.conversation_id);
  const setCurrentConversationId = useImStore(
    (state) => state.setCurrentConversationId,
  );
  const setDirectDraft = useImStore((state) => state.setDirectDraft);
  const setMobilePanel = useImStore((state) => state.setMobilePanel);
  const setWorkspaceNotice = useImStore((state) => state.setWorkspaceNotice);
  const [username, setUsername] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const members = membersQuery.data ?? [];

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const exactUsername = username.trim();

    if (!exactUsername) {
      setAddError(t("im.validation.exactUsernameRequired"));
      return;
    }

    setIsAdding(true);
    setAddError(null);

    try {
      const user = await apiClient.lookupUser(exactUsername);
      const addedMember = await apiClient.addMember(
        conversation.conversation_id,
        { user_id: user.user_id },
      );

      queryClient.setQueryData<ConversationMember[]>(
        imQueryKeys.members(conversation.conversation_id),
        (currentMembers = []) => upsertMember(currentMembers, addedMember),
      );
      setUsername("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: imQueryKeys.conversations(),
        }),
        queryClient.invalidateQueries({
          queryKey: imQueryKeys.members(conversation.conversation_id),
        }),
      ]);
    } catch (error) {
      setAddError(toLookupOrActionErrorMessage(error, t));
    } finally {
      setIsAdding(false);
    }
  }

  async function leaveCurrentGroup() {
    const confirmed = window.confirm(t("im.memberPanel.leaveConfirm"));

    if (!confirmed) {
      return;
    }

    setIsLeaving(true);
    setLeaveError(null);

    try {
      await apiClient.leaveGroup(conversation.conversation_id);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: imQueryKeys.conversations(),
        }),
        queryClient.invalidateQueries({
          queryKey: imQueryKeys.members(conversation.conversation_id),
        }),
      ]);
      setCurrentConversationId(null);
      setDirectDraft(null);
      setWorkspaceNotice({ type: "left_group" });
      setMobilePanel("conversations");
      onOpenChange(false);
      navigate("/app/im");
    } catch {
      setLeaveError(t("im.memberPanel.leaveError"));
    } finally {
      setIsLeaving(false);
    }
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="flex flex-col" side="right">
        <SheetHeader>
          <SheetTitle>{t("im.memberPanel.title")}</SheetTitle>
          <SheetDescription>
            {t("im.memberPanel.description")}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-[var(--accent)]">
              <UsersRound aria-hidden="true" className="size-4" />
              {t("im.memberPanel.activeMembers")}
            </div>

            {membersQuery.isLoading ? (
              <MemberPanelNotice>{t("common.loading")}</MemberPanelNotice>
            ) : membersQuery.isError ? (
              <MemberPanelNotice>
                {t("im.memberPanel.membersError")}
              </MemberPanelNotice>
            ) : members.length === 0 ? (
              <MemberPanelNotice>
                {t("im.memberPanel.noMembers")}
              </MemberPanelNotice>
            ) : (
              <ul className="space-y-2">
                {members.map((member) => (
                  <li key={member.user_id}>
                    <MemberRow member={member} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3 rounded-[calc(var(--radius)*1.05)] border border-[var(--border)] bg-white/58 p-4">
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-[var(--accent)]">
              <UserPlus aria-hidden="true" className="size-4" />
              {t("im.memberPanel.add")}
            </div>
            <form className="space-y-3" onSubmit={addMember}>
              <label
                className="text-sm font-bold text-[var(--foreground)]"
                htmlFor="member-panel-username"
              >
                {t("common.username")}
              </label>
              <div className="flex gap-2">
                <Input
                  autoComplete="off"
                  id="member-panel-username"
                  onChange={(event) => {
                    setUsername(event.target.value);
                    if (addError) {
                      setAddError(null);
                    }
                  }}
                  placeholder={t("im.newDirect.usernamePlaceholder")}
                  value={username}
                />
                <Button disabled={isAdding} type="submit" variant="secondary">
                  {t("im.memberPanel.add")}
                </Button>
              </div>
              {addError ? (
                <p
                  className="rounded-[var(--radius)] border border-[color-mix(in_oklab,var(--destructive)_28%,white)] bg-[color-mix(in_oklab,var(--destructive)_8%,white)] px-3 py-2 text-sm font-semibold text-[var(--destructive)]"
                  role="alert"
                >
                  {addError}
                </p>
              ) : null}
            </form>
          </section>
        </div>

        <SheetFooter>
          {leaveError ? (
            <p
              className="rounded-[var(--radius)] border border-[color-mix(in_oklab,var(--destructive)_28%,white)] bg-[color-mix(in_oklab,var(--destructive)_8%,white)] px-3 py-2 text-sm font-semibold text-[var(--destructive)]"
              role="alert"
            >
              {leaveError}
            </p>
          ) : null}
          <Button
            disabled={isLeaving}
            onClick={() => {
              void leaveCurrentGroup();
            }}
            type="button"
            variant="destructive"
          >
            {t("im.memberPanel.leave")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function MemberRow({ member }: { member: UserSummary }) {
  return (
    <div className="flex items-center gap-3 rounded-[calc(var(--radius)*0.9)] border border-[var(--border)] bg-white/72 px-3 py-3 shadow-sm">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[calc(var(--radius)*0.75)] bg-[var(--foreground)] text-sm font-black text-white">
        {getInitials(member)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold text-[var(--foreground)]">
          {displayUserName(member)}
        </span>
        <span className="block truncate text-xs font-semibold text-[var(--muted-foreground)]">
          @{member.username}
        </span>
      </span>
    </div>
  );
}

function MemberPanelNotice({ children }: { children: string }) {
  return (
    <p className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-white/54 px-3 py-3 text-sm font-semibold text-[var(--muted-foreground)]">
      {children}
    </p>
  );
}

function upsertMember(
  members: ConversationMember[],
  addedMember: ConversationMember,
) {
  if (members.some((member) => member.user_id === addedMember.user_id)) {
    return members;
  }

  return [...members, addedMember];
}

function toLookupOrActionErrorMessage(
  error: unknown,
  t: (key: string) => string,
) {
  if (error instanceof ApiError && error.code === "user_not_found") {
    return t("im.validation.userNotFound");
  }

  return t("im.memberPanel.addError");
}

function displayUserName(user: UserSummary) {
  return user.display_name?.trim() || user.username;
}

function getInitials(user: UserSummary) {
  const name = displayUserName(user).trim();

  if (!name) {
    return "?";
  }

  const parts = name.split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return initials.toUpperCase();
}
