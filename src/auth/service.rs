use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::http::StatusCode;
use chrono::{DateTime, Duration, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use password_hash::SaltString;
use rand_core::OsRng;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    auth::types::{AuthResponse, Claims, CurrentUser, LoginRequest, RegisterRequest},
    config::Config,
    error::{AppError, AppResult, ErrorCode},
    ids::{UserId, new_uuid_v7},
    time::{now_utc, to_rfc3339_utc},
    users::{
        service::normalize_display_name,
        types::{UserSummary, validate_username},
    },
};

const ACCESS_TOKEN_TTL_DAYS: i64 = 7;

#[derive(Debug, sqlx::FromRow)]
struct AuthUserRow {
    user_id: UserId,
    username: String,
    display_name: Option<String>,
    password_hash: String,
}

#[derive(Debug, sqlx::FromRow)]
struct CurrentUserRow {
    user_id: UserId,
    username: String,
    display_name: Option<String>,
    client_id: Uuid,
}

impl From<&AuthUserRow> for UserSummary {
    fn from(row: &AuthUserRow) -> Self {
        Self {
            user_id: row.user_id,
            username: row.username.clone(),
            display_name: row.display_name.clone(),
        }
    }
}

impl From<CurrentUserRow> for CurrentUser {
    fn from(row: CurrentUserRow) -> Self {
        Self {
            user_id: row.user_id,
            username: row.username,
            display_name: row.display_name,
            client_id: row.client_id,
        }
    }
}

pub async fn register(
    pool: &PgPool,
    config: &Config,
    request: RegisterRequest,
) -> AppResult<AuthResponse> {
    let username = normalize_username_for_register(request.username)?;
    validate_password(&request.password)?;
    let display_name = normalize_display_name(request.display_name)?;
    let password_hash = hash_password(&request.password)?;
    let client_id = new_uuid_v7();
    let now = now_utc();

    let mut tx = pool.begin().await.map_err(internal_error)?;

    let user = sqlx::query_as::<_, AuthUserRow>(
        "insert into users (username, display_name, password_hash, created_at, updated_at)
         values ($1, $2, $3, $4, $4)
         returning user_id, username, display_name, password_hash",
    )
    .bind(&username)
    .bind(&display_name)
    .bind(&password_hash)
    .bind(now)
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| {
        if is_unique_violation(&error, Some("users_username_unique")) {
            AppError::new(
                StatusCode::CONFLICT,
                ErrorCode::UsernameTaken,
                "Username is already taken",
            )
        } else {
            internal_error(error)
        }
    })?;

    sqlx::query(
        "insert into clients (client_id, user_id, created_at, last_login_at) values ($1, $2, $3, $3)",
    )
    .bind(client_id)
    .bind(user.user_id)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(internal_error)?;

    tx.commit().await.map_err(internal_error)?;

    auth_response(config, UserSummary::from(&user), client_id, now)
}

pub async fn login(
    pool: &PgPool,
    config: &Config,
    request: LoginRequest,
) -> AppResult<AuthResponse> {
    let username = normalize_username_for_login(&request.username)?;

    let user = sqlx::query_as::<_, AuthUserRow>(
        "select user_id, username, display_name, password_hash from users where username = $1",
    )
    .bind(username)
    .fetch_optional(pool)
    .await
    .map_err(internal_error)?
    .ok_or_else(invalid_credentials)?;

    if !verify_password(&request.password, &user.password_hash)? {
        return Err(invalid_credentials());
    }

    let now = now_utc();
    let client_id = match request.client_id {
        Some(client_id) => reuse_client(pool, user.user_id, client_id, now).await?,
        None => create_client(pool, user.user_id, now).await?,
    };

    auth_response(config, UserSummary::from(&user), client_id, now)
}

pub async fn authenticate_bearer(
    pool: &PgPool,
    config: &Config,
    authorization: Option<&str>,
) -> AppResult<CurrentUser> {
    let token = bearer_token(authorization)?;
    let claims = decode_access_token(config, token)?;
    let user_id = claims.sub.parse::<UserId>().map_err(|_| invalid_token())?;

    let current_user = sqlx::query_as::<_, CurrentUserRow>(
        "select u.user_id, u.username, u.display_name, c.client_id
         from clients c
         join users u on u.user_id = c.user_id
         where u.user_id = $1 and c.client_id = $2",
    )
    .bind(user_id)
    .bind(claims.client_id)
    .fetch_optional(pool)
    .await
    .map_err(internal_error)?
    .ok_or_else(invalid_token)?;

    Ok(current_user.into())
}

fn normalize_username_for_register(username: String) -> AppResult<String> {
    let username = username.to_ascii_lowercase();
    validate_username(&username).map_err(|_| {
        AppError::new(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidRequest,
            "username must be 3-32 characters and contain only lowercase letters, digits, or underscores",
        )
    })?;
    Ok(username)
}

fn normalize_username_for_login(username: &str) -> AppResult<String> {
    let username = username.to_ascii_lowercase();
    validate_username(&username).map_err(|_| invalid_credentials())?;
    Ok(username)
}

fn validate_password(password: &str) -> AppResult<()> {
    let len = password.chars().count();
    if (8..=128).contains(&len) {
        Ok(())
    } else {
        Err(AppError::new(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidRequest,
            "password must be 8-128 characters",
        ))
    }
}

fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| {
            tracing::error!(%error, "password hash failed");
            AppError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                ErrorCode::Internal,
                "Internal server error",
            )
        })
}

fn verify_password(password: &str, password_hash: &str) -> AppResult<bool> {
    let parsed_hash = PasswordHash::new(password_hash).map_err(|error| {
        tracing::error!(%error, "stored password hash was invalid");
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            ErrorCode::Internal,
            "Internal server error",
        )
    })?;

    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

async fn create_client(pool: &PgPool, user_id: UserId, now: DateTime<Utc>) -> AppResult<Uuid> {
    let client_id = new_uuid_v7();
    sqlx::query(
        "insert into clients (client_id, user_id, created_at, last_login_at) values ($1, $2, $3, $3)",
    )
    .bind(client_id)
    .bind(user_id)
    .bind(now)
    .execute(pool)
    .await
    .map_err(internal_error)?;
    Ok(client_id)
}

async fn reuse_client(
    pool: &PgPool,
    user_id: UserId,
    client_id: Uuid,
    now: DateTime<Utc>,
) -> AppResult<Uuid> {
    let owner_user_id =
        sqlx::query_scalar::<_, UserId>("select user_id from clients where client_id = $1")
            .bind(client_id)
            .fetch_optional(pool)
            .await
            .map_err(internal_error)?
            .ok_or_else(|| {
                AppError::new(
                    StatusCode::NOT_FOUND,
                    ErrorCode::ClientNotFound,
                    "Client was not found",
                )
            })?;

    if owner_user_id != user_id {
        return Err(AppError::new(
            StatusCode::FORBIDDEN,
            ErrorCode::ClientOwnerMismatch,
            "Client does not belong to this user",
        ));
    }

    sqlx::query("update clients set last_login_at = $2 where client_id = $1")
        .bind(client_id)
        .bind(now)
        .execute(pool)
        .await
        .map_err(internal_error)?;

    Ok(client_id)
}

fn auth_response(
    config: &Config,
    user: UserSummary,
    client_id: Uuid,
    issued_at: DateTime<Utc>,
) -> AppResult<AuthResponse> {
    let expires_at = issued_at + Duration::days(ACCESS_TOKEN_TTL_DAYS);
    let access_token = issue_access_token(config, user.user_id, client_id, issued_at, expires_at)?;
    Ok(AuthResponse {
        user,
        client_id,
        access_token,
        expires_at: to_rfc3339_utc(expires_at),
    })
}

fn issue_access_token(
    config: &Config,
    user_id: UserId,
    client_id: Uuid,
    issued_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
) -> AppResult<String> {
    let claims = Claims {
        sub: user_id.to_string(),
        client_id,
        iat: issued_at.timestamp() as usize,
        exp: expires_at.timestamp() as usize,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|error| {
        tracing::error!(%error, "jwt encode failed");
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            ErrorCode::Internal,
            "Internal server error",
        )
    })
}

fn decode_access_token(config: &Config, token: &str) -> AppResult<Claims> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(config.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)
    .map_err(|_| invalid_token())
}

fn bearer_token(authorization: Option<&str>) -> AppResult<&str> {
    let authorization = authorization.ok_or_else(invalid_token)?;
    authorization
        .strip_prefix("Bearer ")
        .filter(|token| !token.is_empty())
        .ok_or_else(invalid_token)
}

fn invalid_credentials() -> AppError {
    AppError::new(
        StatusCode::UNAUTHORIZED,
        ErrorCode::InvalidCredentials,
        "Invalid username or password",
    )
}

fn invalid_token() -> AppError {
    AppError::new(
        StatusCode::UNAUTHORIZED,
        ErrorCode::InvalidToken,
        "Missing or invalid bearer token",
    )
}

fn internal_error(error: sqlx::Error) -> AppError {
    tracing::error!(%error, "database operation failed");
    AppError::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        ErrorCode::Internal,
        "Internal server error",
    )
}

fn is_unique_violation(error: &sqlx::Error, constraint: Option<&str>) -> bool {
    let Some(database_error) = error.as_database_error() else {
        return false;
    };

    if database_error.code().as_deref() != Some("23505") {
        return false;
    }

    match constraint {
        Some(expected) => database_error.constraint() == Some(expected),
        None => true,
    }
}
