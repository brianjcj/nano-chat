import { describe, expect, it } from "vitest";

import {
  createSessionStore,
  SESSION_STORAGE_KEY,
  type Session,
  type StorageLike,
} from "./sessionStore";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const session: Session = {
  access_token: "access-token-1",
  client_id: "client-1",
  expires_at: "2999-01-01T00:00:00.000Z",
  user: {
    user_id: "user-1",
    username: "alice",
    display_name: "Alice",
  },
};

describe("sessionStore", () => {
  it("saves and loads access_token, client_id, expires_at, and user", () => {
    const storage = new MemoryStorage();
    const store = createSessionStore(storage);

    store.save(session);

    expect(store.load()).toEqual(session);
  });

  it("treats expires_at in the past as expired", () => {
    const storage = new MemoryStorage();
    const store = createSessionStore(storage);

    store.save({ ...session, expires_at: "2000-01-01T00:00:00.000Z" });

    expect(store.load()).toBeNull();
  });

  it("clear() removes the localStorage key", () => {
    const storage = new MemoryStorage();
    const store = createSessionStore(storage);

    store.save(session);
    store.clear();

    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("returns null and does not throw when stored JSON is corrupt", () => {
    const storage = new MemoryStorage();
    const store = createSessionStore(storage);
    storage.setItem(SESSION_STORAGE_KEY, "{not-valid-json");

    expect(() => store.load()).not.toThrow();
    expect(store.load()).toBeNull();
  });
});
