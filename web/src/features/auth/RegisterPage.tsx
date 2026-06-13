import type { FormEvent } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import {
  useRegisterMutation,
  useTranslatedApiErrorMessage,
} from "./authHooks";
import type { RegisterRequest } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";

type RegisterFormErrors = {
  username?: string;
  password?: string;
  form?: string;
};

export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const registerMutation = useRegisterMutation();
  const translateApiErrorMessage = useTranslatedApiErrorMessage();
  const [formErrors, setFormErrors] = useState<RegisterFormErrors>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const username = getFormString(formData, "username").trim();
    const displayName = getFormString(formData, "display_name").trim();
    const password = getFormString(formData, "password");
    const nextErrors: RegisterFormErrors = {};

    if (!username) {
      nextErrors.username = t("auth.validation.usernameRequired");
    }

    if (!password) {
      nextErrors.password = t("auth.validation.passwordRequired");
    }

    setFormErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const request: RegisterRequest = { username, password };

    if (displayName) {
      request.display_name = displayName;
    }

    try {
      await registerMutation.mutateAsync(request);
      navigate("/app/im", { replace: true });
    } catch (error) {
      setFormErrors({ form: translateApiErrorMessage(error) });
    }
  }

  return (
    <Card className="bg-white/88 backdrop-blur-xl">
      <CardHeader>
        <CardTitle className="text-3xl">{t("auth.register.title")}</CardTitle>
        <CardDescription>{t("auth.register.subtitle")}</CardDescription>
      </CardHeader>
      <form noValidate onSubmit={handleSubmit}>
        <CardContent className="space-y-5">
          {formErrors.form ? (
            <div
              className="rounded-[var(--radius)] border border-[var(--destructive)]/25 bg-[var(--destructive)]/10 px-4 py-3 text-sm font-medium text-[var(--destructive)]"
              role="alert"
            >
              {formErrors.form}
            </div>
          ) : null}

          <div className="space-y-2">
            <label
              className="text-sm font-semibold text-[var(--foreground)]"
              htmlFor="register-username"
            >
              {t("auth.register.usernameLabel")}
            </label>
            <Input
              aria-describedby={
                formErrors.username ? "register-username-error" : undefined
              }
              aria-invalid={Boolean(formErrors.username)}
              autoComplete="username"
              disabled={registerMutation.isPending}
              id="register-username"
              name="username"
            />
            {formErrors.username ? (
              <p
                className="text-sm font-medium text-[var(--destructive)]"
                id="register-username-error"
              >
                {formErrors.username}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-semibold text-[var(--foreground)]"
              htmlFor="register-display-name"
            >
              {t("auth.register.displayNameLabel")}
            </label>
            <Input
              autoComplete="nickname"
              disabled={registerMutation.isPending}
              id="register-display-name"
              name="display_name"
            />
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-semibold text-[var(--foreground)]"
              htmlFor="register-password"
            >
              {t("auth.register.passwordLabel")}
            </label>
            <Input
              aria-describedby={
                formErrors.password ? "register-password-error" : undefined
              }
              aria-invalid={Boolean(formErrors.password)}
              autoComplete="new-password"
              disabled={registerMutation.isPending}
              id="register-password"
              name="password"
              type="password"
            />
            {formErrors.password ? (
              <p
                className="text-sm font-medium text-[var(--destructive)]"
                id="register-password-error"
              >
                {formErrors.password}
              </p>
            ) : null}
          </div>
        </CardContent>

        <CardFooter className="flex-col items-stretch">
          <Button disabled={registerMutation.isPending} size="lg" type="submit">
            {registerMutation.isPending
              ? t("auth.register.submitting")
              : t("auth.register.submit")}
          </Button>
          <Button asChild type="button" variant="ghost">
            <Link to="/login">{t("auth.register.loginCta")}</Link>
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value : "";
}
