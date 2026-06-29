use axum::http::StatusCode;
use sqlx::PgPool;

use crate::{
    error::{AppError, AppResult, ErrorCode},
    ids::UserId,
    time::now_utc,
    users::types::{UserSummary, validate_username},
};

#[derive(Debug, sqlx::FromRow)]
struct UserSummaryRow {
    user_id: UserId,
    username: String,
    display_name: Option<String>,
}

impl From<UserSummaryRow> for UserSummary {
    fn from(row: UserSummaryRow) -> Self {
        Self {
            user_id: row.user_id,
            username: row.username,
            display_name: row.display_name,
        }
    }
}

pub fn normalize_display_name(display_name: Option<String>) -> AppResult<Option<String>> {
    display_name
        .map(|value| {
            let trimmed = value.trim().to_string();
            let len = trimmed.chars().count();
            if (1..=80).contains(&len) {
                Ok(trimmed)
            } else {
                Err(AppError::new(
                    StatusCode::BAD_REQUEST,
                    ErrorCode::InvalidRequest,
                    "display_name must be 1-80 characters when present",
                ))
            }
        })
        .transpose()
}

pub async fn get_user_by_id(pool: &PgPool, user_id: UserId) -> AppResult<UserSummary> {
    let user = sqlx::query_as::<_, UserSummaryRow>(
        "select user_id, username, display_name from users where user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(internal_error)?
    .ok_or_else(|| {
        AppError::new(
            StatusCode::NOT_FOUND,
            ErrorCode::UserNotFound,
            "User was not found",
        )
    })?;

    Ok(user.into())
}

pub async fn get_user_by_username(pool: &PgPool, username: &str) -> AppResult<UserSummary> {
    let username = username.to_ascii_lowercase();
    validate_username(&username).map_err(|_| {
        AppError::new(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidRequest,
            "username must be 3-32 characters and contain only lowercase letters, digits, or underscores",
        )
    })?;

    let user = sqlx::query_as::<_, UserSummaryRow>(
        "select user_id, username, display_name from users where username = $1",
    )
    .bind(username)
    .fetch_optional(pool)
    .await
    .map_err(internal_error)?
    .ok_or_else(|| {
        AppError::new(
            StatusCode::NOT_FOUND,
            ErrorCode::UserNotFound,
            "User was not found",
        )
    })?;

    Ok(user.into())
}

pub async fn update_display_name(
    pool: &PgPool,
    user_id: UserId,
    display_name: Option<String>,
) -> AppResult<UserSummary> {
    let display_name = normalize_display_name(display_name)?;
    let now = now_utc();

    let user = sqlx::query_as::<_, UserSummaryRow>(
        "update users set display_name = $2, updated_at = $3 where user_id = $1 returning user_id, username, display_name",
    )
    .bind(user_id)
    .bind(display_name)
    .bind(now)
    .fetch_optional(pool)
    .await
    .map_err(internal_error)?
    .ok_or_else(|| {
        AppError::new(
            StatusCode::NOT_FOUND,
            ErrorCode::UserNotFound,
            "User was not found",
        )
    })?;

    Ok(user.into())
}

fn internal_error(error: sqlx::Error) -> AppError {
    tracing::error!(%error, "database operation failed");
    AppError::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        ErrorCode::Internal,
        "Internal server error",
    )
}
