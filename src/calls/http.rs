use axum::{Json, Router, extract::State, routing::get};
use chrono::Duration;
use serde::Serialize;

use crate::{
    app::AppState,
    auth::types::CurrentUser,
    calls::ice::generate_turn_credentials,
    error::AppResult,
    time::{now_utc, to_rfc3339_utc},
};

pub fn router() -> Router<AppState> {
    Router::new().route("/calls/ice-servers", get(get_ice_servers))
}

async fn get_ice_servers(
    current_user: CurrentUser,
    State(state): State<AppState>,
) -> AppResult<Json<IceServersResponse>> {
    let ttl = Duration::seconds(state.config.turn_credential_ttl_secs.min(i64::MAX as u64) as i64);
    let credentials = generate_turn_credentials(
        &state.config.turn_shared_secret,
        current_user.user_id,
        current_user.client_id,
        ttl,
        now_utc(),
    );

    Ok(Json(IceServersResponse {
        ice_servers: vec![
            IceServer {
                urls: vec![state.config.stun_url.clone()],
                username: None,
                credential: None,
            },
            IceServer {
                urls: vec![
                    state.config.turn_udp_url.clone(),
                    state.config.turn_tcp_url.clone(),
                ],
                username: Some(credentials.username),
                credential: Some(credentials.credential),
            },
        ],
        expires_at: to_rfc3339_utc(credentials.expires_at),
    }))
}

#[derive(Debug, Serialize)]
struct IceServersResponse {
    ice_servers: Vec<IceServer>,
    expires_at: String,
}

#[derive(Debug, Serialize)]
struct IceServer {
    urls: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    credential: Option<String>,
}
