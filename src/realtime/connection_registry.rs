use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex, MutexGuard},
};

use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

use crate::{
    realtime::types::{ConnectionId, ConnectionSender, RegisteredConnection},
    ws::protocol::ServerEnvelope,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegistryError {
    TooManyConnections,
}

#[derive(Clone)]
pub struct ConnectionRegistry {
    inner: Arc<Mutex<RegistryInner>>,
    max_connections_per_user: usize,
}

#[derive(Default)]
struct RegistryInner {
    connections: HashMap<ConnectionId, ConnectionEntry>,
    by_user: HashMap<Uuid, HashSet<ConnectionId>>,
    by_conversation: HashMap<Uuid, HashSet<ConnectionId>>,
}

struct ConnectionEntry {
    user_id: Uuid,
    client_id: Uuid,
    sender: ConnectionSender,
    connected_at: DateTime<Utc>,
    last_seen_at: DateTime<Utc>,
    subscriptions: HashSet<Uuid>,
}

impl ConnectionRegistry {
    pub fn new(max_connections_per_user: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(RegistryInner::default())),
            max_connections_per_user,
        }
    }

    pub fn register(
        &self,
        user_id: Uuid,
        client_id: Uuid,
        sender: ConnectionSender,
    ) -> Result<RegisteredConnection, RegistryError> {
        self.register_seen_at(user_id, client_id, sender, Utc::now())
    }

    pub fn unregister(&self, connection_id: ConnectionId) -> Option<RegisteredConnection> {
        let mut inner = self.lock_inner();
        remove_connection(&mut inner, connection_id)
    }

    pub fn touch(&self, connection_id: ConnectionId) -> bool {
        self.touch_at(connection_id, Utc::now())
    }

    pub fn touch_at(&self, connection_id: ConnectionId, seen_at: DateTime<Utc>) -> bool {
        let mut inner = self.lock_inner();
        let Some(connection) = inner.connections.get_mut(&connection_id) else {
            return false;
        };
        connection.last_seen_at = seen_at;
        true
    }

    pub fn contains(&self, connection_id: ConnectionId) -> bool {
        self.lock_inner().connections.contains_key(&connection_id)
    }

    pub fn connection_count_for_user(&self, user_id: Uuid) -> usize {
        self.lock_inner()
            .by_user
            .get(&user_id)
            .map_or(0, HashSet::len)
    }

    pub fn is_user_at_limit(&self, user_id: Uuid) -> bool {
        self.connection_count_for_user(user_id) >= self.max_connections_per_user
    }

    pub fn subscribe(&self, connection_id: ConnectionId, conversation_id: Uuid) -> bool {
        let mut inner = self.lock_inner();
        let Some(connection) = inner.connections.get_mut(&connection_id) else {
            return false;
        };
        connection.subscriptions.insert(conversation_id);
        inner
            .by_conversation
            .entry(conversation_id)
            .or_default()
            .insert(connection_id);
        true
    }

    pub fn unsubscribe(&self, connection_id: ConnectionId, conversation_id: Uuid) -> bool {
        let mut inner = self.lock_inner();
        let Some(connection) = inner.connections.get_mut(&connection_id) else {
            return false;
        };
        connection.subscriptions.remove(&conversation_id);
        if let Some(connection_ids) = inner.by_conversation.get_mut(&conversation_id) {
            connection_ids.remove(&connection_id);
            if connection_ids.is_empty() {
                inner.by_conversation.remove(&conversation_id);
            }
        }
        true
    }

    pub fn send_to_users(
        &self,
        user_ids: impl IntoIterator<Item = Uuid>,
        envelope: ServerEnvelope,
        skip_connection_id: Option<ConnectionId>,
    ) -> usize {
        let targets = {
            let inner = self.lock_inner();
            let mut seen_connections = HashSet::new();
            let mut targets = Vec::new();

            for user_id in user_ids {
                let Some(connection_ids) = inner.by_user.get(&user_id) else {
                    continue;
                };

                for connection_id in connection_ids {
                    if Some(*connection_id) == skip_connection_id
                        || !seen_connections.insert(*connection_id)
                    {
                        continue;
                    }
                    if let Some(connection) = inner.connections.get(connection_id) {
                        targets.push(connection.sender.clone());
                    }
                }
            }

            targets
        };

        targets
            .into_iter()
            .filter(|sender| sender.send(envelope.clone()).is_ok())
            .count()
    }

    pub fn send_to_conversation(
        &self,
        conversation_id: Uuid,
        envelope: ServerEnvelope,
        skip_connection_id: Option<ConnectionId>,
    ) -> usize {
        let targets = {
            let inner = self.lock_inner();
            let Some(connection_ids) = inner.by_conversation.get(&conversation_id) else {
                return 0;
            };

            connection_ids
                .iter()
                .filter(|connection_id| Some(**connection_id) != skip_connection_id)
                .filter_map(|connection_id| inner.connections.get(connection_id))
                .map(|connection| connection.sender.clone())
                .collect::<Vec<_>>()
        };

        targets
            .into_iter()
            .filter(|sender| sender.send(envelope.clone()).is_ok())
            .count()
    }

    pub fn cleanup_idle(&self, now: DateTime<Utc>, idle_timeout: Duration) -> Vec<ConnectionId> {
        let cutoff = now - idle_timeout;
        let mut inner = self.lock_inner();
        let idle_connection_ids = inner
            .connections
            .iter()
            .filter_map(|(connection_id, connection)| {
                (connection.last_seen_at < cutoff).then_some(*connection_id)
            })
            .collect::<Vec<_>>();

        for connection_id in &idle_connection_ids {
            remove_connection(&mut inner, *connection_id);
        }

        idle_connection_ids
    }

    #[cfg(test)]
    pub fn register_test_connection(
        &self,
        user_id: Uuid,
        client_id: Uuid,
    ) -> Result<RegisteredConnection, RegistryError> {
        let (sender, _receiver) = tokio::sync::mpsc::unbounded_channel();
        self.register(user_id, client_id, sender)
    }

    #[cfg(test)]
    pub fn register_test_connection_with_sender(
        &self,
        user_id: Uuid,
        client_id: Uuid,
        sender: ConnectionSender,
    ) -> Result<RegisteredConnection, RegistryError> {
        self.register(user_id, client_id, sender)
    }

    #[cfg(test)]
    pub fn register_test_connection_seen_at(
        &self,
        user_id: Uuid,
        client_id: Uuid,
        seen_at: DateTime<Utc>,
    ) -> Result<RegisteredConnection, RegistryError> {
        let (sender, _receiver) = tokio::sync::mpsc::unbounded_channel();
        self.register_seen_at(user_id, client_id, sender, seen_at)
    }

    fn register_seen_at(
        &self,
        user_id: Uuid,
        client_id: Uuid,
        sender: ConnectionSender,
        seen_at: DateTime<Utc>,
    ) -> Result<RegisteredConnection, RegistryError> {
        let mut inner = self.lock_inner();
        if inner.by_user.get(&user_id).map_or(0, HashSet::len) >= self.max_connections_per_user {
            return Err(RegistryError::TooManyConnections);
        }

        let connection_id = Uuid::now_v7();
        let connection = ConnectionEntry {
            user_id,
            client_id,
            sender,
            connected_at: seen_at,
            last_seen_at: seen_at,
            subscriptions: HashSet::new(),
        };
        inner
            .by_user
            .entry(user_id)
            .or_default()
            .insert(connection_id);
        inner.connections.insert(connection_id, connection);

        Ok(RegisteredConnection {
            connection_id,
            user_id,
            client_id,
            connected_at: seen_at,
            last_seen_at: seen_at,
        })
    }

    fn lock_inner(&self) -> MutexGuard<'_, RegistryInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn remove_connection(
    inner: &mut RegistryInner,
    connection_id: ConnectionId,
) -> Option<RegisteredConnection> {
    let connection = inner.connections.remove(&connection_id)?;

    if let Some(connection_ids) = inner.by_user.get_mut(&connection.user_id) {
        connection_ids.remove(&connection_id);
        if connection_ids.is_empty() {
            inner.by_user.remove(&connection.user_id);
        }
    }

    for conversation_id in &connection.subscriptions {
        if let Some(connection_ids) = inner.by_conversation.get_mut(conversation_id) {
            connection_ids.remove(&connection_id);
            if connection_ids.is_empty() {
                inner.by_conversation.remove(conversation_id);
            }
        }
    }

    Some(RegisteredConnection {
        connection_id,
        user_id: connection.user_id,
        client_id: connection.client_id,
        connected_at: connection.connected_at,
        last_seen_at: connection.last_seen_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ws::protocol::ServerEnvelope;
    use chrono::{Duration, Utc};
    use serde_json::json;
    use tokio::sync::mpsc;

    #[test]
    fn registry_enforces_per_user_connection_limit() {
        let registry = ConnectionRegistry::new(2);
        let user_id = uuid::Uuid::now_v7();
        let client_id = uuid::Uuid::now_v7();
        assert!(
            registry
                .register_test_connection(user_id, client_id)
                .is_ok()
        );
        assert!(
            registry
                .register_test_connection(user_id, client_id)
                .is_ok()
        );
        assert!(
            registry
                .register_test_connection(user_id, client_id)
                .is_err()
        );
    }

    #[test]
    fn registry_fanout_skips_origin_connection() {
        let registry = ConnectionRegistry::new(10);
        let user_id = uuid::Uuid::now_v7();
        let client_id = uuid::Uuid::now_v7();
        let (origin_tx, mut origin_rx) = mpsc::unbounded_channel();
        let (other_tx, mut other_rx) = mpsc::unbounded_channel();
        let origin = registry
            .register_test_connection_with_sender(user_id, client_id, origin_tx)
            .unwrap();
        registry
            .register_test_connection_with_sender(user_id, client_id, other_tx)
            .unwrap();

        let sent = registry.send_to_users(
            [user_id],
            ServerEnvelope::event("message.created", json!({"message_seq": 1})),
            Some(origin.connection_id),
        );

        assert_eq!(sent, 1);
        assert!(origin_rx.try_recv().is_err());
        let delivered = other_rx.try_recv().unwrap();
        assert_eq!(delivered.message_type, "message.created");
    }

    #[test]
    fn registry_cleanup_removes_idle_connections() {
        let registry = ConnectionRegistry::new(10);
        let user_id = uuid::Uuid::now_v7();
        let client_id = uuid::Uuid::now_v7();
        let now = Utc::now();
        let stale = registry
            .register_test_connection_seen_at(user_id, client_id, now - Duration::seconds(120))
            .unwrap();
        registry
            .register_test_connection_seen_at(user_id, client_id, now - Duration::seconds(10))
            .unwrap();

        let removed = registry.cleanup_idle(now, Duration::seconds(90));

        assert_eq!(removed, vec![stale.connection_id]);
        assert_eq!(registry.connection_count_for_user(user_id), 1);
    }
}
