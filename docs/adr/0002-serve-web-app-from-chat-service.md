# Serve the Web application from the chat service

Nano Chat v1 serves the built Web application as static assets from the same Rust chat service that owns HTTP APIs, WebSocket connections, and background realtime tasks. This keeps the browser application same-origin with `/api/v1` and `/ws`, avoids CORS and split deployment concerns for v1, and preserves the single-service operational shape while still allowing the Web application to be developed with Vite and deployed as static build output.
