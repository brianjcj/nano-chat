use base64::{Engine as _, engine::general_purpose::STANDARD};
use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha1::Sha1;
use uuid::Uuid;

use crate::ids::UserId;

type HmacSha1 = Hmac<Sha1>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TurnCredentials {
    pub username: String,
    pub credential: String,
    pub expires_at: DateTime<Utc>,
}

pub fn generate_turn_credentials(
    secret: &str,
    user_id: UserId,
    client_id: Uuid,
    ttl: Duration,
    now: DateTime<Utc>,
) -> TurnCredentials {
    let expires_at = now + ttl;
    let username = format!("{}:{}:{}", expires_at.timestamp(), user_id, client_id);
    let mut mac = HmacSha1::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(username.as_bytes());
    let credential = STANDARD.encode(mac.finalize().into_bytes());
    TurnCredentials {
        username,
        credential,
        expires_at,
    }
}

#[cfg(test)]
mod tests {
    use super::generate_turn_credentials;
    use crate::ids::UserId;
    use chrono::{Duration, TimeZone, Utc};
    use uuid::Uuid;

    #[test]
    fn generate_turn_credentials_is_deterministic_for_fixed_inputs() {
        let secret = "0123456789abcdef0123456789abcdef";
        let user_id = UserId::new(42).expect("positive user id");
        let client_id =
            Uuid::parse_str("018fa4aa-4b7d-7cc0-9d7d-9ec78c5a0a11").expect("fixed uuid");
        let now = Utc.with_ymd_and_hms(2026, 7, 1, 0, 0, 0).unwrap();

        let credentials =
            generate_turn_credentials(secret, user_id, client_id, Duration::seconds(600), now);

        assert_eq!(
            credentials.username,
            "1782864600:42:018fa4aa-4b7d-7cc0-9d7d-9ec78c5a0a11"
        );
        assert_eq!(credentials.credential, "FSkCJXeh5CBZrguwBrAu4O3oj/Q=");
        assert_eq!(
            credentials.expires_at,
            Utc.with_ymd_and_hms(2026, 7, 1, 0, 10, 0).unwrap()
        );
    }
}
