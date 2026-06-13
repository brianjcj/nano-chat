mod common;

use axum::body::Body;
use http_body_util::BodyExt;
use serde_json::json;
use tower::ServiceExt;

#[tokio::test]
#[serial_test::serial]
async fn register_login_and_reuse_client_id() {
    let app = common::test_app().await;

    let register = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({"username":"alice","password":"password123","display_name":"Alice"}).to_string(),
        ))
        .unwrap();
    let response = app.clone().oneshot(register).await.unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::CREATED);

    let body: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let client_id = body["client_id"].as_str().unwrap().to_owned();
    assert!(body["access_token"].as_str().unwrap().len() > 20);

    let login = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({"username":"alice","password":"password123","client_id":client_id}).to_string(),
        ))
        .unwrap();
    let response = app.oneshot(login).await.unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::OK);
}

#[tokio::test]
#[serial_test::serial]
async fn exact_username_lookup_requires_authentication() {
    let app = common::test_app().await;
    let request = axum::http::Request::builder()
        .uri("/api/v1/users?username=alice")
        .body(Body::empty())
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::UNAUTHORIZED);
}
