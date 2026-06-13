use anyhow::{Context, Result};
use std::{env, fmt::Display, str::FromStr};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub bind_addr: String,
    pub rust_log: String,
    pub notify_channel: String,
    pub max_connections_per_user: usize,
    pub heartbeat_interval_secs: u64,
    pub heartbeat_idle_timeout_secs: u64,
    pub max_ws_payload_bytes: usize,
    pub max_message_bytes: usize,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            database_url: required_env("DATABASE_URL")?,
            jwt_secret: required_env("JWT_SECRET")?,
            bind_addr: required_env("BIND_ADDR")?,
            rust_log: required_env("RUST_LOG")?,
            notify_channel: env::var("NANO_CHAT_NOTIFY_CHANNEL")
                .unwrap_or_else(|_| "nano_chat_events".to_string()),
            max_connections_per_user: optional_env("NANO_CHAT_MAX_CONNECTIONS_PER_USER", 10)?,
            heartbeat_interval_secs: optional_env("NANO_CHAT_HEARTBEAT_INTERVAL_SECS", 30)?,
            heartbeat_idle_timeout_secs: optional_env("NANO_CHAT_HEARTBEAT_IDLE_TIMEOUT_SECS", 90)?,
            max_ws_payload_bytes: optional_env("NANO_CHAT_MAX_WS_PAYLOAD_BYTES", 64 * 1024)?,
            max_message_bytes: optional_env("NANO_CHAT_MAX_MESSAGE_BYTES", 4096)?,
        })
    }
}

fn required_env(name: &str) -> Result<String> {
    env::var(name).with_context(|| format!("{name} is required"))
}

fn optional_env<T>(name: &str, default: T) -> Result<T>
where
    T: FromStr,
    T::Err: Display,
{
    match env::var(name) {
        Ok(value) => value
            .parse::<T>()
            .map_err(|err| anyhow::anyhow!("{name} must be a valid value: {err}")),
        Err(env::VarError::NotPresent) => Ok(default),
        Err(err) => Err(err).with_context(|| format!("{name} is invalid")),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn username_accepts_lowercase_digits_and_underscore() {
        assert!(crate::users::types::validate_username("alice_123").is_ok());
    }

    #[test]
    fn username_rejects_uppercase_and_short_values() {
        assert!(crate::users::types::validate_username("Al").is_err());
        assert!(crate::users::types::validate_username("Alice").is_err());
    }
}
