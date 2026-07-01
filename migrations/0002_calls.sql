alter table messages
    add column message_type text not null default 'text',
    add column metadata jsonb not null default '{}'::jsonb;

alter table messages
    add constraint messages_message_type_check check (message_type in ('text', 'call_event'));

create table call_sessions (
    call_id uuid primary key,
    conversation_id uuid not null references conversations (conversation_id),
    caller_user_id bigint not null references users (user_id),
    callee_user_id bigint not null references users (user_id),
    caller_client_id uuid not null references clients (client_id),
    accepted_client_id uuid references clients (client_id),
    media_type text not null,
    state text not null,
    started_at timestamptz not null,
    accepted_at timestamptz,
    interruption_detected_at timestamptz,
    ended_at timestamptz,
    end_reason text,
    created_message_id uuid references messages (message_id),
    constraint call_sessions_media_type_check check (media_type in ('audio', 'video')),
    constraint call_sessions_state_check check (state in ('ringing', 'connecting', 'active', 'ended')),
    constraint call_sessions_end_reason_check check (
        end_reason is null or end_reason in ('completed', 'rejected', 'canceled', 'timeout', 'busy', 'offline', 'network_error')
    ),
    constraint call_sessions_distinct_users_check check (caller_user_id <> callee_user_id),
    constraint call_sessions_ended_state_check check (
        (state = 'ended' and ended_at is not null and end_reason is not null)
        or (state <> 'ended' and ended_at is null and end_reason is null)
    )
);

create table call_participants (
    call_id uuid not null references call_sessions (call_id) on delete cascade,
    user_id bigint not null references users (user_id),
    role text not null,
    state text not null,
    primary key (call_id, user_id),
    constraint call_participants_role_check check (role in ('caller', 'callee')),
    constraint call_participants_state_check check (state in ('ringing', 'connecting', 'active', 'ended'))
);

create unique index call_participants_one_active_call_per_user_idx
    on call_participants (user_id)
    where state in ('ringing', 'connecting', 'active');

create index call_sessions_conversation_started_idx
    on call_sessions (conversation_id, started_at desc);

create index call_sessions_state_started_idx
    on call_sessions (state, started_at);
