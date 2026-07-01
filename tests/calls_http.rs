mod common;

use axum::http::StatusCode;
use tower::ServiceExt;

#[tokio::test]
#[serial_test::serial]
async fn ice_servers_requires_authentication() {
    let ctx = common::TestContext::new().await;
    let request = common::json_request("GET", "/api/v1/calls/ice-servers", serde_json::json!({}));
    let response = ctx.app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
#[serial_test::serial]
async fn ice_servers_returns_short_lived_turn_credentials() {
    let ctx = common::TestContext::new().await;
    let alice = ctx.register("alice").await;
    let request = common::authed_empty_request("GET", "/api/v1/calls/ice-servers", &alice);
    let response = ctx.app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = common::response_json(response).await;

    let ice_servers = body["ice_servers"].as_array().unwrap();
    assert!(ice_servers.iter().any(|server| {
        server["urls"]
            .as_array()
            .unwrap()
            .iter()
            .any(|url| url == "stun:turn.example.com:3478")
    }));
    let turn = ice_servers
        .iter()
        .find(|server| server["username"].is_string())
        .unwrap();
    assert!(
        turn["username"]
            .as_str()
            .unwrap()
            .contains(&alice.user_id.to_string())
    );
    assert!(turn["credential"].as_str().unwrap().len() > 20);
    assert!(body["expires_at"].as_str().unwrap().ends_with('Z'));
}
