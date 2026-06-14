mod common;

use std::{fs, path::PathBuf};

use axum::{
    body::Body,
    http::{Request, StatusCode, header::CONTENT_TYPE},
    response::Response,
};
use http_body_util::BodyExt;
use nano_chat::app::{AppState, build_router};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

struct TempWebDist {
    path: PathBuf,
}

impl TempWebDist {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("nano-chat-static-web-{}", Uuid::now_v7()));
        fs::create_dir_all(path.join("assets")).expect("create temp web dist");
        fs::write(
            path.join("index.html"),
            "<!doctype html><html><body><div id=\"root\">Nano Chat</div></body></html>",
        )
        .expect("write index.html");
        fs::write(path.join("assets/app.js"), "console.log('nano chat');").expect("write asset");
        Self { path }
    }

    fn path_string(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }
}

impl Drop for TempWebDist {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn static_web_app(web_dist: &TempWebDist) -> axum::Router {
    let mut config = common::test_config();
    config.web_dist_dir = web_dist.path_string();
    let pool = PgPoolOptions::new()
        .connect_lazy(&config.database_url)
        .expect("create lazy test database pool");
    build_router(AppState::new(config, pool))
}

async fn get(app: axum::Router, uri: &str) -> Response {
    app.oneshot(
        Request::builder()
            .method("GET")
            .uri(uri)
            .body(Body::empty())
            .unwrap(),
    )
    .await
    .unwrap()
}

async fn response_text(response: Response) -> String {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    String::from_utf8(bytes.to_vec()).expect("response body should be UTF-8")
}

#[tokio::test]
async fn root_returns_index_html() {
    let web_dist = TempWebDist::new();
    let response = get(static_web_app(&web_dist), "/").await;

    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .expect("content-type header");
    assert!(
        content_type.starts_with("text/html"),
        "unexpected content-type: {content_type}"
    );
    let body = response_text(response).await;
    assert!(body.contains("Nano Chat"));
}

#[tokio::test]
async fn assets_return_asset_files() {
    let web_dist = TempWebDist::new();
    let response = get(static_web_app(&web_dist), "/assets/app.js").await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_text(response).await, "console.log('nano chat');");
}

#[tokio::test]
async fn spa_routes_fallback_to_index_html() {
    let web_dist = TempWebDist::new();
    let response = get(static_web_app(&web_dist), "/app/im/conversations/abc").await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_text(response).await;
    assert!(body.contains("Nano Chat"));
}

#[tokio::test]
async fn missing_assets_return_not_found_instead_of_index_html() {
    let web_dist = TempWebDist::new();
    let response = get(static_web_app(&web_dist), "/assets/missing.js").await;
    let status = response.status();
    let body = response_text(response).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body.contains("Nano Chat"));
}

#[tokio::test]
async fn unknown_api_route_is_not_swallowed_by_spa_fallback() {
    let web_dist = TempWebDist::new();
    let response = get(static_web_app(&web_dist), "/api/v1/unknown").await;
    let status = response.status();
    let body = response_text(response).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!body.contains("Nano Chat"));
}

#[tokio::test]
async fn websocket_route_is_not_swallowed_by_spa_fallback() {
    let web_dist = TempWebDist::new();
    let response = get(static_web_app(&web_dist), "/ws?version=1").await;
    let status = response.status();
    let body = response_text(response).await;

    assert_ne!(status, StatusCode::OK);
    assert!(!body.contains("Nano Chat"));
}
