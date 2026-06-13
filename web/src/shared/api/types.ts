export type UserSummary = {
  user_id: string;
  username: string;
  display_name: string | null;
};

export type AuthResponse = {
  user: UserSummary;
  client_id: string;
  access_token: string;
  expires_at: string;
};

export type ConversationType = "direct" | "group";

export type ConversationState = "active" | "dissolved";

export type LatestMessageSummary = {
  message_id: string;
  message_seq: number;
  sender: UserSummary;
  body: string;
  created_at: string;
};

export type ConversationSummary = {
  conversation_id: string;
  type: ConversationType;
  name: string | null;
  state: ConversationState;
  latest_message_seq: number;
  read_seq: number;
  unread_count: number;
  active_member_count: number;
  direct_user: UserSummary | null;
  latest_message: LatestMessageSummary | null;
};

export type Message = {
  message_id: string;
  conversation_id: string;
  message_seq: number;
  sender: UserSummary;
  body: string;
  created_at: string;
};

export type ConversationMember = UserSummary;

export type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
  };
};

export type RegisterRequest = {
  username: string;
  password: string;
  display_name?: string;
};

export type LoginRequest = {
  username: string;
  password: string;
  client_id?: string;
};

export type PatchMeRequest = {
  display_name: string | null;
};

export type CreateGroupRequest = {
  name: string;
  member_ids: string[];
};

export type AddMemberRequest = {
  user_id: string;
};

export type MessageHistoryQuery = {
  after_seq?: number;
  before_seq?: number;
  limit?: number;
};
