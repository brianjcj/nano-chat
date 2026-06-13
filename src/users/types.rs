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
