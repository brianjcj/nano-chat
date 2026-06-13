import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useApiClient, useSession } from "@/app/AppProviders";
import { ApiError } from "@/shared/api/client";
import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
} from "@/shared/api/types";

export function useLoginMutation() {
  const apiClient = useApiClient();
  const { saveSession } = useSession();

  return useMutation<AuthResponse, unknown, LoginRequest>({
    mutationFn: (request) => apiClient.login(request),
    onSuccess: saveSession,
  });
}

export function useRegisterMutation() {
  const apiClient = useApiClient();
  const { saveSession } = useSession();

  return useMutation<AuthResponse, unknown, RegisterRequest>({
    mutationFn: (request) => apiClient.register(request),
    onSuccess: saveSession,
  });
}

export function useTranslatedApiErrorMessage() {
  const { t } = useTranslation();
  const fallbackMessage = t("errors.unknown");

  return useCallback(
    (error: unknown) => {
      const errorCode = getApiErrorCode(error);

      return t(`errors.${errorCode}`, { defaultValue: fallbackMessage });
    },
    [fallbackMessage, t],
  );
}

function getApiErrorCode(error: unknown) {
  return error instanceof ApiError ? error.code : "unknown";
}
