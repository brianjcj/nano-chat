use once_cell::sync::Lazy;
use regex::Regex;

static USERNAME_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[a-z0-9_]{3,32}$").unwrap());

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error(
    "username must be 3-32 characters and contain only lowercase letters, digits, or underscores"
)]
pub struct UsernameValidationError;

pub fn validate_username(username: &str) -> Result<(), UsernameValidationError> {
    if USERNAME_RE.is_match(username) {
        Ok(())
    } else {
        Err(UsernameValidationError)
    }
}

#[cfg(test)]
mod tests {
    use super::validate_username;

    #[test]
    fn username_accepts_lowercase_digits_and_underscore() {
        assert!(validate_username("alice_123").is_ok());
    }

    #[test]
    fn username_rejects_uppercase_and_short_values() {
        assert!(validate_username("Al").is_err());
        assert!(validate_username("Alice").is_err());
    }
}
