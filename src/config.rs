use anyhow::{Context, Result};
use std::{
    env,
    fmt::{self, Display},
    str::FromStr,
};

const DEFAULT_RUST_LOG: &str = "nano_chat=info,tower_http=info";
const DEFAULT_WEB_DIST_DIR: &str = "web/dist";
const DEFAULT_TURN_PUBLIC_HOST: &str = "turn.example.com";
const DEFAULT_TURN_REALM: &str = "turn.example.com";
const DEFAULT_TURN_SHARED_SECRET: &str = "change-me-turn-shared-secret-at-least-32-bytes";
const DEFAULT_TURN_CREDENTIAL_TTL_SECS: u64 = 600;
const DEFAULT_TURN_STUN_URL: &str = "stun:turn.example.com:3478";
const DEFAULT_TURN_UDP_URL: &str = "turn:turn.example.com:3478?transport=udp";
const DEFAULT_TURN_TCP_URL: &str = "turn:turn.example.com:3478?transport=tcp";
const MIN_JWT_SECRET_LEN: usize = 32;
const MIN_TURN_SHARED_SECRET_LEN: usize = 32;

#[derive(Clone, PartialEq, Eq)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub bind_addr: String,
    pub rust_log: String,
    pub web_dist_dir: String,
    pub notify_channel: String,
    pub max_connections_per_user: usize,
    pub heartbeat_interval_secs: u64,
    pub heartbeat_idle_timeout_secs: u64,
    pub max_ws_payload_bytes: usize,
    pub max_message_bytes: usize,
    pub call_ringing_timeout_secs: u64,
    pub call_disconnect_grace_secs: u64,
    pub call_cleanup_interval_secs: u64,
    pub turn_public_host: String,
    pub turn_realm: String,
    pub turn_shared_secret: String,
    pub turn_credential_ttl_secs: u64,
    pub turn_udp_url: String,
    pub turn_tcp_url: String,
    pub stun_url: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            database_url: required_env("DATABASE_URL")?,
            jwt_secret: validate_jwt_secret(required_env("JWT_SECRET")?)?,
            bind_addr: required_env("BIND_ADDR")?,
            rust_log: optional_string_env("RUST_LOG", DEFAULT_RUST_LOG)?,
            web_dist_dir: optional_string_env("WEB_DIST_DIR", DEFAULT_WEB_DIST_DIR)?,
            notify_channel: env::var("NANO_CHAT_NOTIFY_CHANNEL")
                .unwrap_or_else(|_| "nano_chat_events".to_string()),
            max_connections_per_user: optional_env("NANO_CHAT_MAX_CONNECTIONS_PER_USER", 10)?,
            heartbeat_interval_secs: optional_env("NANO_CHAT_HEARTBEAT_INTERVAL_SECS", 30)?,
            heartbeat_idle_timeout_secs: optional_env("NANO_CHAT_HEARTBEAT_IDLE_TIMEOUT_SECS", 90)?,
            max_ws_payload_bytes: optional_env("NANO_CHAT_MAX_WS_PAYLOAD_BYTES", 64 * 1024)?,
            max_message_bytes: optional_env("NANO_CHAT_MAX_MESSAGE_BYTES", 4096)?,
            call_ringing_timeout_secs: optional_env("NANO_CHAT_CALL_RINGING_TIMEOUT_SECS", 60)?,
            call_disconnect_grace_secs: optional_env("NANO_CHAT_CALL_DISCONNECT_GRACE_SECS", 15)?,
            call_cleanup_interval_secs: optional_env("NANO_CHAT_CALL_CLEANUP_INTERVAL_SECS", 5)?,
            turn_public_host: optional_string_env("TURN_PUBLIC_HOST", DEFAULT_TURN_PUBLIC_HOST)?,
            turn_realm: optional_string_env("TURN_REALM", DEFAULT_TURN_REALM)?,
            turn_shared_secret: validate_turn_shared_secret(optional_string_env(
                "TURN_SHARED_SECRET",
                DEFAULT_TURN_SHARED_SECRET,
            )?)?,
            turn_credential_ttl_secs: optional_env(
                "TURN_CREDENTIAL_TTL_SECS",
                DEFAULT_TURN_CREDENTIAL_TTL_SECS,
            )?,
            turn_udp_url: optional_string_env("TURN_UDP_URL", DEFAULT_TURN_UDP_URL)?,
            turn_tcp_url: optional_string_env("TURN_TCP_URL", DEFAULT_TURN_TCP_URL)?,
            stun_url: optional_string_env("TURN_STUN_URL", DEFAULT_TURN_STUN_URL)?,
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
            .field("web_dist_dir", &self.web_dist_dir)
            .field("notify_channel", &self.notify_channel)
            .field("max_connections_per_user", &self.max_connections_per_user)
            .field("heartbeat_interval_secs", &self.heartbeat_interval_secs)
            .field(
                "heartbeat_idle_timeout_secs",
                &self.heartbeat_idle_timeout_secs,
            )
            .field("max_ws_payload_bytes", &self.max_ws_payload_bytes)
            .field("max_message_bytes", &self.max_message_bytes)
            .field("call_ringing_timeout_secs", &self.call_ringing_timeout_secs)
            .field(
                "call_disconnect_grace_secs",
                &self.call_disconnect_grace_secs,
            )
            .field(
                "call_cleanup_interval_secs",
                &self.call_cleanup_interval_secs,
            )
            .field("turn_public_host", &self.turn_public_host)
            .field("turn_realm", &self.turn_realm)
            .field("turn_shared_secret", &"<redacted>")
            .field("turn_credential_ttl_secs", &self.turn_credential_ttl_secs)
            .field("turn_udp_url", &self.turn_udp_url)
            .field("turn_tcp_url", &self.turn_tcp_url)
            .field("stun_url", &self.stun_url)
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

fn validate_turn_shared_secret(secret: String) -> Result<String> {
    anyhow::ensure!(
        secret.chars().count() >= MIN_TURN_SHARED_SECRET_LEN,
        "TURN_SHARED_SECRET must be at least {MIN_TURN_SHARED_SECRET_LEN} characters"
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
        "WEB_DIST_DIR",
        "NANO_CHAT_NOTIFY_CHANNEL",
        "NANO_CHAT_MAX_CONNECTIONS_PER_USER",
        "NANO_CHAT_HEARTBEAT_INTERVAL_SECS",
        "NANO_CHAT_HEARTBEAT_IDLE_TIMEOUT_SECS",
        "NANO_CHAT_MAX_WS_PAYLOAD_BYTES",
        "NANO_CHAT_MAX_MESSAGE_BYTES",
        "NANO_CHAT_CALL_RINGING_TIMEOUT_SECS",
        "NANO_CHAT_CALL_DISCONNECT_GRACE_SECS",
        "NANO_CHAT_CALL_CLEANUP_INTERVAL_SECS",
        "TURN_PUBLIC_HOST",
        "TURN_REALM",
        "TURN_SHARED_SECRET",
        "TURN_CREDENTIAL_TTL_SECS",
        "TURN_STUN_URL",
        "TURN_UDP_URL",
        "TURN_TCP_URL",
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
    fn from_env_defaults_web_dist_dir_when_missing() {
        with_clean_env(|| {
            set_required_env();

            let config = Config::from_env().expect("WEB_DIST_DIR should default when absent");

            assert_eq!(config.web_dist_dir, "web/dist");
        });
    }

    #[test]
    fn from_env_parses_custom_web_dist_dir() {
        with_clean_env(|| {
            set_required_env();
            set_env("WEB_DIST_DIR", "/app/web/dist");

            let config = Config::from_env().expect("config should parse WEB_DIST_DIR");

            assert_eq!(config.web_dist_dir, "/app/web/dist");
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
    fn from_env_defaults_call_cleanup_values() {
        with_clean_env(|| {
            set_required_env();

            let config = Config::from_env().expect("call cleanup config should default");

            assert_eq!(config.call_ringing_timeout_secs, 60);
            assert_eq!(config.call_disconnect_grace_secs, 15);
            assert_eq!(config.call_cleanup_interval_secs, 5);
        });
    }

    #[test]
    fn from_env_parses_custom_call_cleanup_values() {
        with_clean_env(|| {
            set_required_env();
            set_env("NANO_CHAT_CALL_RINGING_TIMEOUT_SECS", "45");
            set_env("NANO_CHAT_CALL_DISCONNECT_GRACE_SECS", "10");
            set_env("NANO_CHAT_CALL_CLEANUP_INTERVAL_SECS", "2");

            let config = Config::from_env().expect("call cleanup config should parse");

            assert_eq!(config.call_ringing_timeout_secs, 45);
            assert_eq!(config.call_disconnect_grace_secs, 10);
            assert_eq!(config.call_cleanup_interval_secs, 2);
        });
    }

    #[test]
    fn from_env_defaults_turn_config() {
        with_clean_env(|| {
            set_required_env();

            let config = Config::from_env().expect("turn config should default");

            assert_eq!(config.turn_public_host, "turn.example.com");
            assert_eq!(config.turn_realm, "turn.example.com");
            assert_eq!(
                config.turn_shared_secret,
                "change-me-turn-shared-secret-at-least-32-bytes"
            );
            assert_eq!(config.turn_credential_ttl_secs, 600);
            assert_eq!(config.stun_url, "stun:turn.example.com:3478");
            assert_eq!(
                config.turn_udp_url,
                "turn:turn.example.com:3478?transport=udp"
            );
            assert_eq!(
                config.turn_tcp_url,
                "turn:turn.example.com:3478?transport=tcp"
            );
        });
    }

    #[test]
    fn from_env_rejects_too_short_turn_shared_secret() {
        with_clean_env(|| {
            set_required_env();
            set_env("TURN_SHARED_SECRET", "too-short");

            let error =
                Config::from_env().expect_err("short TURN_SHARED_SECRET should be rejected");

            assert!(
                error
                    .to_string()
                    .contains("TURN_SHARED_SECRET must be at least 32 characters")
            );
        });
    }

    #[test]
    fn debug_redacts_sensitive_values() {
        let config = Config {
            database_url: "postgres://user:pass@localhost/nano_chat".to_string(),
            jwt_secret: "0123456789abcdef0123456789abcdef".to_string(),
            bind_addr: "127.0.0.1:3000".to_string(),
            rust_log: "nano_chat=debug".to_string(),
            web_dist_dir: "web/dist".to_string(),
            notify_channel: "nano_chat_events".to_string(),
            max_connections_per_user: 10,
            heartbeat_interval_secs: 30,
            heartbeat_idle_timeout_secs: 90,
            max_ws_payload_bytes: 64 * 1024,
            max_message_bytes: 4096,
            call_ringing_timeout_secs: 60,
            call_disconnect_grace_secs: 15,
            call_cleanup_interval_secs: 5,
            turn_public_host: "turn.example.com".to_string(),
            turn_realm: "turn.example.com".to_string(),
            turn_shared_secret: "change-me-turn-shared-secret-at-least-32-bytes".to_string(),
            turn_credential_ttl_secs: 600,
            turn_udp_url: "turn:turn.example.com:3478?transport=udp".to_string(),
            turn_tcp_url: "turn:turn.example.com:3478?transport=tcp".to_string(),
            stun_url: "stun:turn.example.com:3478".to_string(),
        };

        let debug = format!("{config:?}");

        assert!(debug.contains("database_url: \"<redacted>\""));
        assert!(debug.contains("jwt_secret: \"<redacted>\""));
        assert!(debug.contains("web_dist_dir: \"web/dist\""));
        assert!(debug.contains("turn_shared_secret: \"<redacted>\""));
        assert!(debug.contains("stun_url: \"stun:turn.example.com:3478\""));
        assert!(!debug.contains("postgres://user:pass"));
        assert!(!debug.contains("0123456789abcdef0123456789abcdef"));
        assert!(!debug.contains("change-me-turn-shared-secret-at-least-32-bytes"));
    }
}
