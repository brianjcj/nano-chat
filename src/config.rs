use anyhow::{Context, Result};
use std::{
    env,
    fmt::{self, Display},
    str::FromStr,
};

const DEFAULT_RUST_LOG: &str = "nano_chat=info,tower_http=info";
const MIN_JWT_SECRET_LEN: usize = 32;

#[derive(Clone, PartialEq, Eq)]
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
            jwt_secret: validate_jwt_secret(required_env("JWT_SECRET")?)?,
            bind_addr: required_env("BIND_ADDR")?,
            rust_log: optional_string_env("RUST_LOG", DEFAULT_RUST_LOG)?,
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

impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("database_url", &"<redacted>")
            .field("jwt_secret", &"<redacted>")
            .field("bind_addr", &self.bind_addr)
            .field("rust_log", &self.rust_log)
            .field("notify_channel", &self.notify_channel)
            .field("max_connections_per_user", &self.max_connections_per_user)
            .field("heartbeat_interval_secs", &self.heartbeat_interval_secs)
            .field(
                "heartbeat_idle_timeout_secs",
                &self.heartbeat_idle_timeout_secs,
            )
            .field("max_ws_payload_bytes", &self.max_ws_payload_bytes)
            .field("max_message_bytes", &self.max_message_bytes)
            .finish()
    }
}

fn required_env(name: &str) -> Result<String> {
    env::var(name).with_context(|| format!("{name} is required"))
}

fn optional_string_env(name: &str, default: &str) -> Result<String> {
    match env::var(name) {
        Ok(value) => Ok(value),
        Err(env::VarError::NotPresent) => Ok(default.to_string()),
        Err(err) => Err(err).with_context(|| format!("{name} is invalid")),
    }
}

fn validate_jwt_secret(secret: String) -> Result<String> {
    anyhow::ensure!(
        secret.chars().count() >= MIN_JWT_SECRET_LEN,
        "JWT_SECRET must be at least {MIN_JWT_SECRET_LEN} characters"
    );
    Ok(secret)
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
    use super::Config;
    use std::{
        env,
        panic::{UnwindSafe, catch_unwind, resume_unwind},
        sync::Mutex,
    };

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    const ENV_KEYS: &[&str] = &[
        "DATABASE_URL",
        "JWT_SECRET",
        "BIND_ADDR",
        "RUST_LOG",
        "NANO_CHAT_NOTIFY_CHANNEL",
        "NANO_CHAT_MAX_CONNECTIONS_PER_USER",
        "NANO_CHAT_HEARTBEAT_INTERVAL_SECS",
        "NANO_CHAT_HEARTBEAT_IDLE_TIMEOUT_SECS",
        "NANO_CHAT_MAX_WS_PAYLOAD_BYTES",
        "NANO_CHAT_MAX_MESSAGE_BYTES",
    ];

    fn with_clean_env(test: impl FnOnce() + UnwindSafe) {
        let result = {
            let _guard = ENV_LOCK
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let original_values = ENV_KEYS
                .iter()
                .map(|key| (*key, env::var(key).ok()))
                .collect::<Vec<_>>();

            for key in ENV_KEYS {
                remove_env(key);
            }

            let result = catch_unwind(test);

            for (key, value) in original_values {
                match value {
                    Some(value) => set_env(key, &value),
                    None => remove_env(key),
                }
            }

            result
        };

        if let Err(payload) = result {
            resume_unwind(payload);
        }
    }

    fn set_required_env() {
        set_env("DATABASE_URL", "postgres://nano:nano@localhost/nano_chat");
        set_env("JWT_SECRET", "0123456789abcdef0123456789abcdef");
        set_env("BIND_ADDR", "127.0.0.1:3000");
        set_env("RUST_LOG", "nano_chat=debug");
    }

    fn set_env(key: &str, value: &str) {
        unsafe {
            env::set_var(key, value);
        }
    }

    fn remove_env(key: &str) {
        unsafe {
            env::remove_var(key);
        }
    }

    #[test]
    fn from_env_fails_when_database_url_is_missing() {
        with_clean_env(|| {
            set_env("JWT_SECRET", "0123456789abcdef0123456789abcdef");
            set_env("BIND_ADDR", "127.0.0.1:3000");
            set_env("RUST_LOG", "nano_chat=debug");

            let error = Config::from_env().expect_err("DATABASE_URL should be required");

            assert!(error.to_string().contains("DATABASE_URL is required"));
        });
    }

    #[test]
    fn from_env_defaults_rust_log_when_missing() {
        with_clean_env(|| {
            set_env("DATABASE_URL", "postgres://nano:nano@localhost/nano_chat");
            set_env("JWT_SECRET", "0123456789abcdef0123456789abcdef");
            set_env("BIND_ADDR", "127.0.0.1:3000");

            let config = Config::from_env().expect("RUST_LOG should default when absent");

            assert_eq!(config.rust_log, "nano_chat=info,tower_http=info");
        });
    }

    #[test]
    fn from_env_rejects_too_short_jwt_secret() {
        with_clean_env(|| {
            set_env("DATABASE_URL", "postgres://nano:nano@localhost/nano_chat");
            set_env("JWT_SECRET", "too-short");
            set_env("BIND_ADDR", "127.0.0.1:3000");
            set_env("RUST_LOG", "nano_chat=debug");

            let error = Config::from_env().expect_err("short JWT_SECRET should be rejected");

            assert!(
                error
                    .to_string()
                    .contains("JWT_SECRET must be at least 32 characters")
            );
        });
    }

    #[test]
    fn from_env_parses_custom_max_connections_per_user() {
        with_clean_env(|| {
            set_required_env();
            set_env("NANO_CHAT_MAX_CONNECTIONS_PER_USER", "25");

            let config = Config::from_env().expect("config should parse custom numeric env");

            assert_eq!(config.max_connections_per_user, 25);
        });
    }

    #[test]
    fn debug_redacts_sensitive_values() {
        let config = Config {
            database_url: "postgres://user:pass@localhost/nano_chat".to_string(),
            jwt_secret: "0123456789abcdef0123456789abcdef".to_string(),
            bind_addr: "127.0.0.1:3000".to_string(),
            rust_log: "nano_chat=debug".to_string(),
            notify_channel: "nano_chat_events".to_string(),
            max_connections_per_user: 10,
            heartbeat_interval_secs: 30,
            heartbeat_idle_timeout_secs: 90,
            max_ws_payload_bytes: 64 * 1024,
            max_message_bytes: 4096,
        };

        let debug = format!("{config:?}");

        assert!(debug.contains("database_url: \"<redacted>\""));
        assert!(debug.contains("jwt_secret: \"<redacted>\""));
        assert!(!debug.contains("postgres://user:pass"));
        assert!(!debug.contains("0123456789abcdef0123456789abcdef"));
    }
}
