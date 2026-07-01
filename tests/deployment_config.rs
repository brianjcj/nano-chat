#[test]
fn compose_declares_caddy_and_coturn_services() {
    let compose = std::fs::read_to_string("docker-compose.yml").unwrap();
    assert!(compose.contains("  caddy:"));
    assert!(compose.contains("  coturn:"));
    assert!(compose.contains("80:80"));
    assert!(compose.contains("443:443"));
    assert!(compose.contains("3478:3478/udp"));
    assert!(compose.contains("3478:3478/tcp"));
}

#[test]
fn coturn_uses_shared_secret_and_relay_range() {
    let config = std::fs::read_to_string("coturn/turnserver.conf").unwrap();
    assert!(config.contains("use-auth-secret"));
    assert!(config.contains("static-auth-secret="));
    assert!(config.contains("min-port=49160"));
    assert!(config.contains("max-port=49200"));
}
