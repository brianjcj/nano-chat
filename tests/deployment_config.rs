fn read_required(path: &str) -> String {
    std::fs::read_to_string(path)
        .unwrap_or_else(|err| panic!("expected {path} to be readable: {err}"))
}

#[test]
fn compose_declares_caddy_and_coturn_services() {
    let compose = read_required("docker-compose.yml");
    assert!(compose.contains("  caddy:"));
    assert!(compose.contains("  coturn:"));
    assert!(compose.contains("80:80"));
    assert!(compose.contains("443:443"));
    assert!(compose.contains("3478:3478/udp"));
    assert!(compose.contains("3478:3478/tcp"));
    assert!(compose.contains("49160-49200:49160-49200/udp"));
}

#[test]
fn coturn_renders_active_config_from_template() {
    let compose = read_required("docker-compose.yml");
    let entrypoint = read_required("coturn/entrypoint.sh");
    let template = read_required("coturn/turnserver.conf.template");

    assert!(compose.contains("entrypoint: [\"/usr/local/bin/nano-chat-coturn-entrypoint.sh\"]"));
    assert!(
        compose.contains("./coturn/entrypoint.sh:/usr/local/bin/nano-chat-coturn-entrypoint.sh:ro")
    );
    assert!(
        compose
            .contains("./coturn/turnserver.conf.template:/etc/coturn/turnserver.conf.template:ro")
    );
    assert!(
        !compose.contains("./coturn/turnserver.conf:/etc/coturn/turnserver.conf:ro"),
        "coturn must not mount an unrendered config as the active config"
    );
    assert!(
        !compose.contains("/etc/coturn/turnserver.conf\"]"),
        "coturn must not start from the unrendered config path"
    );

    assert!(entrypoint.contains("sed"));
    assert!(entrypoint.contains("TURN_SHARED_SECRET"));
    assert!(entrypoint.contains("TURN_REALM"));
    assert!(entrypoint.contains("/etc/coturn/turnserver.conf.template"));
    assert!(entrypoint.contains("/tmp/turnserver.conf"));
    assert!(entrypoint.contains("exec turnserver -c /tmp/turnserver.conf"));

    assert!(template.contains("use-auth-secret"));
    assert!(template.contains("static-auth-secret=__TURN_SHARED_SECRET__"));
    assert!(template.contains("realm=__TURN_REALM__"));
    assert!(template.contains("server-name=__TURN_REALM__"));
    assert!(template.contains("min-port=49160"));
    assert!(template.contains("max-port=49200"));
    assert!(
        !template.contains("${TURN_SHARED_SECRET}") && !template.contains("${TURN_REALM}"),
        "template placeholders must not look like shell variables that coturn could receive literally"
    );
}

#[test]
fn turn_external_ip_is_configured_documented_and_rendered_when_set() {
    let compose = read_required("docker-compose.yml");
    let env = read_required(".env.example");
    let docs = read_required("docs/deployment-webrtc.md");
    let api = read_required("docs/api.md");
    let entrypoint = read_required("coturn/entrypoint.sh");
    let template = read_required("coturn/turnserver.conf.template");

    assert!(compose.contains("TURN_EXTERNAL_IP: ${TURN_EXTERNAL_IP:-}"));
    assert!(env.contains("TURN_EXTERNAL_IP="));
    assert!(docs.contains("TURN_EXTERNAL_IP"));
    assert!(docs.contains("VPS public IP"));
    assert!(api.contains("TURN_EXTERNAL_IP"));
    assert!(api.contains("VPS public IP"));
    assert!(entrypoint.contains("TURN_EXTERNAL_IP"));
    assert!(entrypoint.contains("external-ip="));
    assert!(template.contains("__TURN_EXTERNAL_IP_CONFIG__"));
}

#[test]
fn app_port_is_absent_or_clearly_marked_legacy_for_caddy_profile() {
    let env = read_required(".env.example");

    if env.contains("APP_PORT=") {
        let lower = env.to_lowercase();
        assert!(lower.contains("legacy"));
        assert!(lower.contains("caddy"));
        assert!(lower.contains("not used") || lower.contains("unused"));
    }
}
