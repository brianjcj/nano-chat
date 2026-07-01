import type {
  AddMemberRequest,
  AuthResponse,
  ConversationMember,
  ConversationSummary,
  CreateGroupRequest,
  ErrorEnvelope,
  IceServersResponse,
  LoginRequest,
  Message,
  MessageHistoryQuery,
  PatchMeRequest,
  RegisterRequest,
  UserSummary,
} from "./types";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export type ApiClient = {
  register(request: RegisterRequest): Promise<AuthResponse>;
  login(request: LoginRequest): Promise<AuthResponse>;
  getMe(): Promise<UserSummary>;
  patchMe(request: PatchMeRequest): Promise<UserSummary>;
  lookupUser(username: string): Promise<UserSummary>;
  listConversations(): Promise<ConversationSummary[]>;
  createGroup(request: CreateGroupRequest): Promise<ConversationSummary>;
  listMembers(conversationId: string): Promise<ConversationMember[]>;
  addMember(
    conversationId: string,
    request: AddMemberRequest,
  ): Promise<ConversationMember>;
  leaveGroup(conversationId: string): Promise<void>;
  listMessages(
    conversationId: string,
    query?: MessageHistoryQuery,
  ): Promise<Message[]>;
  getIceServers(): Promise<IceServersResponse>;
};

type ApiClientOptions = {
  baseUrl: string;
  getAccessToken: () => string | null;
  onUnauthorized: () => void;
  fetchImpl?: typeof fetch;
};

type QueryValue = string | number | boolean | null | undefined;

type RequestOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, QueryValue>;
};

const AUTH_FAILURE_ERROR_CODES = new Set(["invalid_token"]);
const NETWORK_ERROR_MESSAGE =
  "Network request failed. Please check your connection and try again.";
const INVALID_RESPONSE_MESSAGE =
  "The server returned an invalid response. Please try again.";

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));

  async function request<T>(path: string, requestOptions: RequestOptions = {}) {
    const headers = new Headers({ Accept: "application/json" });
    const accessToken = options.getAccessToken();

    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }

    if (requestOptions.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;

    try {
      response = await fetchImpl(buildUrl(baseUrl, path, requestOptions.query), {
        method: requestOptions.method ?? "GET",
        headers,
        body:
          requestOptions.body === undefined
            ? undefined
            : JSON.stringify(requestOptions.body),
      });
    } catch {
      throw new ApiError("network", NETWORK_ERROR_MESSAGE, 0);
    }

    if (!response.ok) {
      const apiError = await toApiError(response);

      if (shouldHandleUnauthorized(response.status, apiError.code)) {
        options.onUnauthorized();
      }

      throw apiError;
    }

    if (response.status === 204) {
      return undefined as T;
    }

    try {
      const text = await response.text();

      return (text ? JSON.parse(text) : undefined) as T;
    } catch {
      throw new ApiError(
        "invalid_response",
        INVALID_RESPONSE_MESSAGE,
        response.status,
      );
    }
  }

  return {
    register(registerRequest) {
      return request<AuthResponse>("/auth/register", {
        method: "POST",
        body: registerRequest,
      });
    },
    login(loginRequest) {
      return request<AuthResponse>("/auth/login", {
        method: "POST",
        body: loginRequest,
      });
    },
    getMe() {
      return request<UserSummary>("/me");
    },
    patchMe(patchRequest) {
      return request<UserSummary>("/me", {
        method: "PATCH",
        body: patchRequest,
      });
    },
    lookupUser(username) {
      return request<UserSummary>("/users", { query: { username } });
    },
    listConversations() {
      return request<ConversationSummary[]>("/conversations");
    },
    createGroup(createRequest) {
      return request<ConversationSummary>("/conversations/groups", {
        method: "POST",
        body: createRequest,
      });
    },
    listMembers(conversationId) {
      return request<ConversationMember[]>(
        `/conversations/${encodeURIComponent(conversationId)}/members`,
      );
    },
    addMember(conversationId, addRequest) {
      return request<ConversationMember>(
        `/conversations/${encodeURIComponent(conversationId)}/members`,
        {
          method: "POST",
          body: addRequest,
        },
      );
    },
    leaveGroup(conversationId) {
      return request<void>(
        `/conversations/${encodeURIComponent(conversationId)}/members/me`,
        { method: "DELETE" },
      );
    },
    listMessages(conversationId, query) {
      return request<Message[]>(
        `/conversations/${encodeURIComponent(conversationId)}/messages`,
        { query },
      );
    },
    getIceServers() {
      return request<IceServersResponse>("/calls/ice-servers");
    },
  };
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, QueryValue>,
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }

  const queryString = params.toString();

  return `${baseUrl}${path}${queryString ? `?${queryString}` : ""}`;
}

function shouldHandleUnauthorized(status: number, code: string) {
  return (
    status === 401 &&
    (AUTH_FAILURE_ERROR_CODES.has(code) || code === "http_401")
  );
}

async function toApiError(response: Response) {
  const fallbackCode = `http_${response.status}`;
  const fallbackMessage = response.statusText || "Request failed";

  try {
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as unknown) : null;

    if (isErrorEnvelope(parsed)) {
      return new ApiError(
        parsed.error.code,
        parsed.error.message,
        response.status,
      );
    }
  } catch {
    return new ApiError(fallbackCode, fallbackMessage, response.status);
  }

  return new ApiError(fallbackCode, fallbackMessage, response.status);
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!isRecord(value) || !isRecord(value.error)) {
    return false;
  }

  return (
    typeof value.error.code === "string" &&
    typeof value.error.message === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
