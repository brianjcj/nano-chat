use chrono::{DateTime, Utc};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::ws::protocol::ServerEnvelope;

pub type ConnectionId = Uuid;
pub type ConnectionSender = mpsc::Sender<ServerEnvelope>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegisteredConnection {
    pub connection_id: ConnectionId,
    pub user_id: Uuid,
    pub client_id: Uuid,
    pub connected_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
}
