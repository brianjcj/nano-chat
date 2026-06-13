import type { UserSummary } from "../api/types";

export const SESSION_STORAGE_KEY = "nano-chat.session.v1";

export type Session = {
  access_token: string;
  client_id: string;
  expires_at: string;
  user: UserSummary;
};

export type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export type SessionStore = {
  save(session: Session): void;
  load(): Session | null;
  getValidSession(): Session | null;
  clear(): void;
};

const noopStorage: StorageLike = {
  getItem: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
};

export function createSessionStore(storage: StorageLike = getBrowserStorage()) {
  const resolvedStorage = storage;

  function load() {
    let rawValue: string | null;

    try {
      rawValue = resolvedStorage.getItem(SESSION_STORAGE_KEY);
    } catch {
      return null;
    }

    if (!rawValue) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawValue) as unknown;

      if (!isSession(parsed) || isExpired(parsed.expires_at)) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  return {
    save(session) {
      try {
        resolvedStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      } catch {
        // Storage can be unavailable or full; dropping the session is safer than crashing.
      }
    },
    load,
    getValidSession: load,
    clear() {
      try {
        resolvedStorage.removeItem(SESSION_STORAGE_KEY);
      } catch {
        // Storage can be unavailable; clearing should remain best-effort.
      }
    },
  } satisfies SessionStore;
}

export const sessionStore = createSessionStore();

function getBrowserStorage(): StorageLike {
  if (typeof window === "undefined") {
    return noopStorage;
  }

  try {
    return window.localStorage;
  } catch {
    return noopStorage;
  }
}

function isExpired(expiresAt: string) {
  const expiresAtMs = Date.parse(expiresAt);

  return Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now();
}

function isSession(value: unknown): value is Session {
  if (!isRecord(value) || !isUserSummary(value.user)) {
    return false;
  }

  return (
    typeof value.access_token === "string" &&
    typeof value.client_id === "string" &&
    typeof value.expires_at === "string"
  );
}

function isUserSummary(value: unknown): value is UserSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.user_id === "string" &&
    typeof value.username === "string" &&
    (typeof value.display_name === "string" || value.display_name === null)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
