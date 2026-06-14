FROM node:24-bookworm AS web-builder
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app/web
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM rust:1.95-bookworm AS rust-builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release --locked

FROM debian:12-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=rust-builder /app/target/release/nano-chat /usr/local/bin/nano-chat
COPY migrations ./migrations
COPY --from=web-builder /app/web/dist ./web/dist
ENV BIND_ADDR=0.0.0.0:3000
ENV WEB_DIST_DIR=/app/web/dist
EXPOSE 3000
CMD ["nano-chat"]
