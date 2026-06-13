use axum::{Router, routing::get};

use crate::app::AppState;

pub mod handler;
pub mod protocol;

pub fn router() -> Router<AppState> {
    Router::new().route("/ws", get(handler::ws_handler))
}
