# WebRTC Single-VPS Deployment

Open inbound TCP 80 and 443 for Caddy.
Open inbound UDP 3478 and TCP 3478 for coturn.
Open inbound UDP 49160-49200 for TURN relay traffic.
Set NANO_CHAT_DOMAIN to the HTTPS app host.
Set TURN_PUBLIC_HOST and TURN_REALM to the TURN host.
Use the same TURN_SHARED_SECRET for the app and coturn.
Run: docker compose --profile app up -d --build
