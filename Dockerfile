# syntax=docker/dockerfile:1

FROM rust:1.84-bookworm AS builder
WORKDIR /app

COPY Cargo.toml ./
COPY rust-src ./rust-src

RUN cargo build --release

FROM debian:bookworm-slim
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/bizneo_clockin_telegram_bot /usr/local/bin/bizneo_clockin_telegram_bot

ENV NODE_ENV=production
ENV DATA_DIR=/data

VOLUME ["/data"]

CMD ["bizneo_clockin_telegram_bot"]
