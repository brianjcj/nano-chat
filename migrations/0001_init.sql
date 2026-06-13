create table users (
    user_id uuid primary key,
    username text not null,
    display_name text,
    password_hash text not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    constraint users_username_unique unique (username),
    constraint users_username_not_blank check (length(username) > 0)
);

create table clients (
    client_id uuid primary key,
    user_id uuid not null references users (user_id),
    created_at timestamptz not null,
    last_login_at timestamptz not null
);

create table conversations (
    conversation_id uuid primary key,
    type text not null,
    name text,
    state text not null,
    last_message_seq bigint not null default 0,
    last_message_id uuid,
    last_message_at timestamptz,
    created_by uuid not null references users (user_id),
    created_at timestamptz not null,
    updated_at timestamptz not null,
    dissolved_at timestamptz,
    constraint conversations_type_check check (type in ('direct', 'group')),
    constraint conversations_state_check check (state in ('active', 'dissolved')),
    constraint conversations_last_message_seq_check check (last_message_seq >= 0),
    constraint conversations_dissolved_at_check check (
        (state = 'active' and dissolved_at is null)
        or (state = 'dissolved' and dissolved_at is not null)
    )
);

create table direct_conversation_pairs (
    conversation_id uuid primary key references conversations (conversation_id),
    user_low uuid not null references users (user_id),
    user_high uuid not null references users (user_id),
    constraint direct_conversation_pairs_user_order_check check (user_low < user_high),
    constraint direct_conversation_pairs_user_pair_unique unique (user_low, user_high)
);

create table conversation_members (
    conversation_id uuid not null references conversations (conversation_id),
    user_id uuid not null references users (user_id),
    state text not null,
    read_seq bigint not null default 0,
    joined_at timestamptz not null,
    left_at timestamptz,
    primary key (conversation_id, user_id),
    constraint conversation_members_state_check check (state in ('active', 'left')),
    constraint conversation_members_read_seq_check check (read_seq >= 0),
    constraint conversation_members_left_at_check check (
        (state = 'active' and left_at is null)
        or (state = 'left' and left_at is not null and left_at >= joined_at)
    )
);

create table conversation_member_spans (
    span_id uuid primary key,
    conversation_id uuid not null references conversations (conversation_id),
    user_id uuid not null references users (user_id),
    from_seq bigint not null,
    to_seq bigint,
    created_at timestamptz not null,
    closed_at timestamptz,
    constraint conversation_member_spans_from_seq_check check (from_seq > 0),
    constraint conversation_member_spans_range_check check (to_seq is null or to_seq >= from_seq - 1),
    constraint conversation_member_spans_closed_check check (
        (to_seq is null and closed_at is null)
        or (to_seq is not null and closed_at is not null and closed_at >= created_at)
    )
);

create table messages (
    message_id uuid primary key,
    conversation_id uuid not null references conversations (conversation_id),
    message_seq bigint not null,
    sender_user_id uuid not null references users (user_id),
    client_id uuid not null references clients (client_id),
    client_msg_id text not null,
    body text not null,
    body_hash text not null,
    request_fingerprint text not null,
    created_at timestamptz not null,
    constraint messages_message_seq_check check (message_seq > 0),
    constraint messages_client_msg_id_not_blank check (length(client_msg_id) > 0),
    constraint messages_body_not_blank check (length(body) > 0),
    constraint messages_body_hash_not_blank check (length(body_hash) > 0),
    constraint messages_request_fingerprint_not_blank check (length(request_fingerprint) > 0),
    constraint messages_conversation_seq_unique unique (conversation_id, message_seq),
    constraint messages_sender_client_msg_unique unique (sender_user_id, client_id, client_msg_id)
);

create index clients_user_id_idx on clients (user_id);

create index conversations_last_message_idx
    on conversations (last_message_at desc nulls last, last_message_seq desc);

create index conversation_members_active_by_user_idx
    on conversation_members (user_id, conversation_id)
    where state = 'active';

create index conversation_members_active_by_conversation_idx
    on conversation_members (conversation_id, user_id)
    where state = 'active';

create index conversation_member_spans_visibility_idx
    on conversation_member_spans (conversation_id, user_id, from_seq, to_seq);

create unique index conversation_member_spans_one_open_idx
    on conversation_member_spans (conversation_id, user_id)
    where to_seq is null;

create index messages_conversation_seq_desc_idx
    on messages (conversation_id, message_seq desc);

create index messages_sender_created_at_idx
    on messages (sender_user_id, created_at desc);
