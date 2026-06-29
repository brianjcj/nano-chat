mod common;

use axum::{
    body::Body,
    http::{
        Request, StatusCode,
        header::{AUTHORIZATION, CONTENT_TYPE},
    },
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

#[tokio::test]
#[serial_test::serial]
async fn register_login_and_reuse_client_id() {
    let app = common::test_app().await;

    let register = json_request(
        "POST",
        "/api/v1/auth/register",
        json!({"username":"alice","password":"password123","display_name":"Alice"}),
    );
    let response = app.clone().oneshot(register).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    let body = response_json(response).await;
    let user_id_value = body["user"]["user_id"].as_str().expect("user_id is string");
    let numeric_user_id: i64 = user_id_value.parse().expect("user_id parses as integer");
    assert!(numeric_user_id > 0);
    assert!(uuid::Uuid::parse_str(user_id_value).is_err());
    let client_id = body["client_id"].as_str().unwrap().to_owned();
    assert!(body["access_token"].as_str().unwrap().len() > 20);

    let login = json_request(
        "POST",
        "/api/v1/auth/login",
        json!({"username":"alice","password":"password123","client_id":client_id}),
    );
    let response = app.oneshot(login).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
#[serial_test::serial]
async fn register_malformed_json_returns_invalid_request_envelope() {
    let app = common::test_app().await;

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from("{"))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_invalid_request(response).await;
}

#[tokio::test]
#[serial_test::serial]
async fn register_wrong_content_type_returns_invalid_request_envelope() {
    let app = common::test_app().await;

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register")
        .header(CONTENT_TYPE, "text/plain")
        .body(Body::from(
            json!({"username":"alice","password":"password123"}).to_string(),
        ))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_invalid_request(response).await;
}

#[tokio::test]
#[serial_test::serial]
async fn patch_me_empty_body_returns_invalid_request() {
    let app = common::test_app().await;
    let auth = register_alice(&app).await;

    let request = Request::builder()
        .method("PATCH")
        .uri("/api/v1/me")
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, bearer(&auth))
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_invalid_request(response).await;
}

#[tokio::test]
#[serial_test::serial]
async fn patch_me_null_display_name_clears_display_name() {
    let app = common::test_app().await;
    let auth = register_alice(&app).await;
    assert_eq!(auth["user"]["display_name"], "Alice");

    let request = Request::builder()
        .method("PATCH")
        .uri("/api/v1/me")
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, bearer(&auth))
        .body(Body::from(json!({"display_name": null}).to_string()))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body["username"], "alice");
    assert!(body["display_name"].is_null());
}

#[tokio::test]
#[serial_test::serial]
async fn exact_username_lookup_requires_authentication() {
    let app = common::test_app().await;
    let request = Request::builder()
        .uri("/api/v1/users?username=alice")
        .body(Body::empty())
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
#[serial_test::serial]
async fn exact_username_lookup_returns_user_summary() {
    let app = common::test_app().await;
    let auth = register_alice(&app).await;

    let request = Request::builder()
        .uri("/api/v1/users?username=alice")
        .header(AUTHORIZATION, bearer(&auth))
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body, auth["user"]);
}

#[tokio::test]
#[serial_test::serial]
async fn username_lookup_missing_query_returns_invalid_request_envelope() {
    let app = common::test_app().await;
    let auth = register_alice(&app).await;

    let request = Request::builder()
        .uri("/api/v1/users")
        .header(AUTHORIZATION, bearer(&auth))
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_invalid_request(response).await;
}

fn json_request(method: &str, uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn register_alice(app: &axum::Router) -> Value {
    let request = json_request(
        "POST",
        "/api/v1/auth/register",
        json!({"username":"alice","password":"password123","display_name":"Alice"}),
    );
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await
}

fn bearer(auth: &Value) -> String {
    format!("Bearer {}", auth["access_token"].as_str().unwrap())
}

async fn assert_invalid_request(response: axum::response::Response) {
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    assert!(
        content_type.starts_with("application/json"),
        "content-type should be JSON, got {content_type:?}"
    );

    let body = response_json(response).await;
    assert_eq!(body["error"]["code"], "invalid_request");
    assert!(!body["error"]["message"].as_str().unwrap().is_empty());
}

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap_or_else(|error| {
        panic!(
            "response body should be JSON: {error}; body={}",
            String::from_utf8_lossy(&bytes)
        )
    })
}
