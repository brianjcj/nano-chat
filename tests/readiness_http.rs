mod common;

use axum::{body::Body, http::Request};
use nano_chat::app::{AppState, build_router};
use tower::ServiceExt;

#[tokio::test]
#[serial_test::serial]
async fn readyz_returns_ok_when_database_is_reachable_and_app_is_not_draining() {
    let pool = common::test_pool().await;
    common::reset_database(&pool).await;
    nano_chat::db::run_migrations(&pool)
        .await
        .expect("run test migrations");
    let state = AppState::new(common::test_config(), pool);
    state.mark_notify_listener_ready();
    let app = build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/readyz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), axum::http::StatusCode::OK);
}

#[tokio::test]
#[serial_test::serial]
async fn readyz_returns_unavailable_when_app_is_draining() {
    let pool = common::test_pool().await;
    common::reset_database(&pool).await;
    nano_chat::db::run_migrations(&pool)
        .await
        .expect("run test migrations");
    let state = AppState::new(common::test_config(), pool);
    state.mark_notify_listener_ready();
    state.mark_draining();
    let app = build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/readyz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        response.status(),
        axum::http::StatusCode::SERVICE_UNAVAILABLE
    );
}
