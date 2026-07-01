use std::time::Duration;

use sqlx::{PgPool, postgres::PgListener};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::{
    app::AppLifecycle,
    conversations::service as conversations_service,
    error::AppError,
    ids::UserId,
    realtime::{
        connection_registry::ConnectionRegistry,
        types::{RealtimeEvent, RealtimeNotifyPayload, RealtimeNotifyPayloadError},
    },
};

#[derive(Debug, thiserror::Error)]
pub enum NotifyError {
    #[error(transparent)]
    Payload(#[from] RealtimeNotifyPayloadError),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum NotifyFanoutError {
    #[error(transparent)]
    App(#[from] AppError),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

#[derive(Clone)]
pub struct NotifyPublisher {
    pool: PgPool,
    channel: String,
}

impl NotifyPublisher {
    pub fn new(pool: PgPool, channel: impl Into<String>) -> Self {
        Self {
            pool,
            channel: channel.into(),
        }
    }

    pub async fn publish(&self, payload: &RealtimeNotifyPayload) -> Result<(), NotifyError> {
        let encoded = payload.to_pg_notify_payload()?;
        sqlx::query("select pg_notify($1, $2)")
            .bind(&self.channel)
            .bind(encoded)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

pub struct NotifyListener {
    listener: PgListener,
    channel: String,
    local_instance_id: String,
    pool: PgPool,
    registry: ConnectionRegistry,
}

impl NotifyListener {
    pub async fn connect(
        database_url: &str,
        channel: impl Into<String>,
        local_instance_id: impl Into<String>,
        pool: PgPool,
        registry: ConnectionRegistry,
    ) -> Result<Self, NotifyError> {
        let channel = channel.into();
        let mut listener = PgListener::connect(database_url).await?;
        listener.listen(&channel).await?;
        Ok(Self {
            listener,
            channel,
            local_instance_id: local_instance_id.into(),
            pool,
            registry,
        })
    }

    pub fn start(
        database_url: &str,
        channel: impl Into<String>,
        local_instance_id: impl Into<String>,
        pool: PgPool,
        registry: ConnectionRegistry,
    ) -> JoinHandle<()> {
        Self::start_with_readiness(
            database_url,
            channel,
            local_instance_id,
            pool,
            registry,
            AppLifecycle::new(),
        )
    }

    pub fn start_with_readiness(
        database_url: &str,
        channel: impl Into<String>,
        local_instance_id: impl Into<String>,
        pool: PgPool,
        registry: ConnectionRegistry,
        lifecycle: AppLifecycle,
    ) -> JoinHandle<()> {
        let database_url = database_url.to_string();
        let channel = channel.into();
        let local_instance_id = local_instance_id.into();
        lifecycle.mark_notify_listener_not_ready();

        tokio::spawn(async move {
            loop {
                lifecycle.mark_notify_listener_not_ready();
                match Self::connect(
                    &database_url,
                    channel.clone(),
                    local_instance_id.clone(),
                    pool.clone(),
                    registry.clone(),
                )
                .await
                {
                    Ok(listener) => {
                        lifecycle.mark_notify_listener_ready();
                        if let Err(error) = listener.run().await {
                            lifecycle.mark_notify_listener_not_ready();
                            tracing::error!(%error, "postgres notify listener stopped; reconnecting");
                        }
                    }
                    Err(error) => {
                        lifecycle.mark_notify_listener_not_ready();
                        tracing::error!(%error, "failed to connect postgres notify listener; retrying");
                    }
                }

                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        })
    }

    pub fn spawn(self) -> JoinHandle<()> {
        tokio::spawn(async move {
            if let Err(error) = self.run().await {
                tracing::error!(%error, "postgres notify listener stopped");
            }
        })
    }

    pub async fn run(mut self) -> Result<(), NotifyError> {
        loop {
            let notification = self.listener.recv().await?;
            if notification.channel() != self.channel {
                continue;
            }

            let payload =
                match RealtimeNotifyPayload::from_pg_notify_payload(notification.payload()) {
                    Ok(payload) => payload,
                    Err(error) => {
                        tracing::warn!(%error, "discarding invalid realtime notify payload");
                        continue;
                    }
                };

            if payload.origin_instance_id == self.local_instance_id {
                continue;
            }

            match fanout_notify_payload(&self.pool, &self.registry, &payload).await {
                Ok(delivered) => {
                    tracing::debug!(
                        delivered,
                        event_type = payload.event.event_type(),
                        "delivered realtime notify payload to local websocket connections"
                    );
                }
                Err(error) => {
                    tracing::warn!(
                        %error,
                        event_type = payload.event.event_type(),
                        "failed to fan out realtime notify payload"
                    );
                }
            }
        }
    }
}

pub async fn fanout_notify_payload(
    pool: &PgPool,
    registry: &ConnectionRegistry,
    payload: &RealtimeNotifyPayload,
) -> Result<usize, NotifyFanoutError> {
    let envelope = payload.event.server_envelope();
    let skip_connection_id = payload.origin_connection_id;
    let delivered = match &payload.event {
        RealtimeEvent::MessageCreated {
            conversation_id,
            message,
        } => {
            let user_ids = conversations_service::visible_user_ids_for_message(
                pool,
                *conversation_id,
                message.message_seq,
            )
            .await?;
            registry.send_to_users(user_ids, envelope, skip_connection_id)
        }
        RealtimeEvent::ConversationReadUpdated {
            conversation_id, ..
        }
        | RealtimeEvent::ConversationMemberAdded {
            conversation_id, ..
        } => {
            let user_ids = conversations_service::active_member_ids(pool, *conversation_id).await?;
            registry.send_to_users(user_ids, envelope, skip_connection_id)
        }
        RealtimeEvent::ConversationMemberLeft {
            conversation_id,
            user_id,
        } => {
            let user_ids = active_or_specific_member_ids(pool, *conversation_id, *user_id).await?;
            registry.send_to_users(user_ids, envelope, skip_connection_id)
        }
        RealtimeEvent::ConversationDissolved { user_id, .. } => {
            registry.send_to_users(std::iter::once(*user_id), envelope, skip_connection_id)
        }
        RealtimeEvent::CallIncoming { call }
        | RealtimeEvent::CallRinging { call }
        | RealtimeEvent::CallAccepted { call }
        | RealtimeEvent::CallConnected { call }
        | RealtimeEvent::CallRejected { call }
        | RealtimeEvent::CallCanceled { call }
        | RealtimeEvent::CallEnded { call }
        | RealtimeEvent::CallBusy { call } => registry.send_to_users(
            [call.caller.user_id, call.callee.user_id],
            envelope,
            skip_connection_id,
        ),
        RealtimeEvent::ServerDraining => registry.send_to_all(envelope, skip_connection_id),
    };
    Ok(delivered)
}

async fn active_or_specific_member_ids(
    pool: &PgPool,
    conversation_id: Uuid,
    user_id: UserId,
) -> Result<Vec<UserId>, sqlx::Error> {
    sqlx::query_scalar::<_, UserId>(
        "select user_id
         from conversation_members
         where conversation_id = $1
           and (state = 'active' or user_id = $2)
         order by user_id",
    )
    .bind(conversation_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
}
