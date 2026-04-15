FROM rust:1.86-bookworm AS build
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Prebuild deps for cache.
COPY services/indexer/Cargo.toml services/indexer/Cargo.lock ./services/indexer/
RUN mkdir -p services/indexer/src && echo "fn main() {}" > services/indexer/src/main.rs \
    && echo "" > services/indexer/src/lib.rs
WORKDIR /src/services/indexer
RUN cargo build --release || true
WORKDIR /src

COPY services/indexer ./services/indexer
WORKDIR /src/services/indexer
RUN touch src/main.rs src/lib.rs && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/services/indexer/target/release/saep-indexer /app/saep-indexer
COPY --from=build /src/services/indexer/idl /app/idl
ENV SAEP_IDL_DIR=/app/idl
EXPOSE 8080
CMD ["/app/saep-indexer"]
