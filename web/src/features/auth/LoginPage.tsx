import type { FormEvent } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import {
  useLoginMutation,
  useTranslatedApiErrorMessage,
} from "./authHooks";
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

type LoginFormErrors = {
  username?: string;
  password?: string;
  form?: string;
};

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const loginMutation = useLoginMutation();
  const translateApiErrorMessage = useTranslatedApiErrorMessage();
  const [formErrors, setFormErrors] = useState<LoginFormErrors>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const username = getFormString(formData, "username").trim();
    const password = getFormString(formData, "password");
    const nextErrors: LoginFormErrors = {};

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

    try {
      await loginMutation.mutateAsync({ username, password });
      navigate("/app/im", { replace: true });
    } catch (error) {
      setFormErrors({ form: translateApiErrorMessage(error) });
    }
  }

  return (
    <Card className="bg-white/88 backdrop-blur-xl">
      <CardHeader>
        <CardTitle className="text-3xl">{t("auth.login.title")}</CardTitle>
        <CardDescription>{t("auth.login.subtitle")}</CardDescription>
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
              htmlFor="login-username"
            >
              {t("auth.login.usernameLabel")}
            </label>
            <Input
              aria-describedby={
                formErrors.username ? "login-username-error" : undefined
              }
              aria-invalid={Boolean(formErrors.username)}
              autoComplete="username"
              disabled={loginMutation.isPending}
              id="login-username"
              name="username"
            />
            {formErrors.username ? (
              <p
                className="text-sm font-medium text-[var(--destructive)]"
                id="login-username-error"
              >
                {formErrors.username}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-semibold text-[var(--foreground)]"
              htmlFor="login-password"
            >
              {t("auth.login.passwordLabel")}
            </label>
            <Input
              aria-describedby={
                formErrors.password ? "login-password-error" : undefined
              }
              aria-invalid={Boolean(formErrors.password)}
              autoComplete="current-password"
              disabled={loginMutation.isPending}
              id="login-password"
              name="password"
              type="password"
            />
            {formErrors.password ? (
              <p
                className="text-sm font-medium text-[var(--destructive)]"
                id="login-password-error"
              >
                {formErrors.password}
              </p>
            ) : null}
          </div>
        </CardContent>

        <CardFooter className="flex-col items-stretch">
          <Button disabled={loginMutation.isPending} size="lg" type="submit">
            {loginMutation.isPending
              ? t("auth.login.submitting")
              : t("auth.login.submit")}
          </Button>
          <Button asChild type="button" variant="ghost">
            <Link to="/register">{t("auth.login.registerCta")}</Link>
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
