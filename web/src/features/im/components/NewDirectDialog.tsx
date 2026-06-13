import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { useApiClient } from "@/app/AppProviders";
import { useImStore } from "@/features/im/state/imStore";
import { ApiError } from "@/shared/api/client";
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

export type NewDirectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function NewDirectDialog({
  open,
  onOpenChange,
}: NewDirectDialogProps) {
  const { t } = useTranslation();
  const apiClient = useApiClient();
  const navigate = useNavigate();
  const setCurrentConversationId = useImStore(
    (state) => state.setCurrentConversationId,
  );
  const setDirectDraft = useImStore((state) => state.setDirectDraft);
  const setMobilePanel = useImStore((state) => state.setMobilePanel);
  const setWorkspaceNotice = useImStore((state) => state.setWorkspaceNotice);
  const [username, setUsername] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);

  function resetDialogState() {
    setUsername("");
    setErrorMessage(null);
    setIsLookingUp(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetDialogState();
    }

    onOpenChange(nextOpen);
  }

  async function lookupExactUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const exactUsername = username.trim();

    if (!exactUsername) {
      setErrorMessage(t("im.validation.exactUsernameRequired"));
      return;
    }

    setIsLookingUp(true);
    setErrorMessage(null);

    try {
      const user = await apiClient.lookupUser(exactUsername);

      setDirectDraft({
        target_username: user.username,
        target_user_id: user.user_id,
        target_display_name: user.display_name,
      });
      setCurrentConversationId(null);
      setWorkspaceNotice(null);
      setMobilePanel("chat");
      navigate("/app/im");
      handleOpenChange(false);
    } catch (error) {
      setErrorMessage(toLookupErrorMessage(error, t));
    } finally {
      setIsLookingUp(false);
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("im.newDirect.title")}</DialogTitle>
          <DialogDescription>
            {t("im.newDirect.description")}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={lookupExactUsername}>
          <div className="space-y-2">
            <label
              className="text-sm font-bold text-[var(--foreground)]"
              htmlFor="new-direct-username"
            >
              {t("common.username")}
            </label>
            <Input
              autoComplete="off"
              id="new-direct-username"
              onChange={(event) => {
                setUsername(event.target.value);
                if (errorMessage) {
                  setErrorMessage(null);
                }
              }}
              placeholder={t("im.newDirect.usernamePlaceholder")}
              value={username}
            />
          </div>

          {errorMessage ? (
            <p
              className="rounded-[var(--radius)] border border-[color-mix(in_oklab,var(--destructive)_28%,white)] bg-[color-mix(in_oklab,var(--destructive)_8%,white)] px-3 py-2 text-sm font-semibold text-[var(--destructive)]"
              role="alert"
            >
              {errorMessage}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              disabled={isLookingUp}
              onClick={() => handleOpenChange(false)}
              type="button"
              variant="secondary"
            >
              {t("common.cancel")}
            </Button>
            <Button disabled={isLookingUp} type="submit">
              {t("im.newDirect.lookup")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function toLookupErrorMessage(
  error: unknown,
  t: (key: string) => string,
) {
  if (error instanceof ApiError && error.code === "user_not_found") {
    return t("im.validation.userNotFound");
  }

  return t("im.newDirect.lookupError");
}
