# WebRTC Single-VPS Deployment

Open inbound TCP 80 and 443 for Caddy.
Open inbound UDP 3478 and TCP 3478 for coturn.
Open inbound UDP 49160-49200 for TURN relay traffic.
Set NANO_CHAT_DOMAIN to the HTTPS app host.
Set TURN_PUBLIC_HOST and TURN_REALM to the TURN host.
Set TURN_EXTERNAL_IP to the VPS public IP for real deployments so coturn can render external-ip and advertise reachable relay candidates; leave it empty only for local testing or deployments that do not need external-ip.
Use the same TURN_SHARED_SECRET for the app and coturn.
The coturn container renders coturn/turnserver.conf.template at startup so TURN_SHARED_SECRET, TURN_REALM, and TURN_EXTERNAL_IP are written into /tmp/turnserver.conf before turnserver starts.
Run: docker compose --profile app up -d --build

## Smoke test

1. Point DNS for NANO_CHAT_DOMAIN and TURN_PUBLIC_HOST at the VPS.
2. Open TCP 80/443/3478 and UDP 3478/49160-49200.
3. Run `docker compose --profile app up -d --build`.
4. Open `https://$NANO_CHAT_DOMAIN/healthz` and expect `200 OK`.
5. Log in from two browsers, create a direct conversation, and start an audio call.
6. Confirm `GET /api/v1/calls/ice-servers` returns one STUN server and one TURN server with temporary credentials.
