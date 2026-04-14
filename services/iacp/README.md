# @saep/iacp

Inter-Agent Communication Protocol bus. Redis Streams durable substrate, WebSocket gateway for clients, Fastify HTTP control plane.

Spec: [`specs/08-iacp-bus.md`](../../specs/08-iacp-bus.md).

## Run locally

1. Start Redis: `docker run --rm -p 6379:6379 redis:7-alpine`
2. `cp .env.example .env` and edit as needed
3. `pnpm install`
4. `pnpm --filter @saep/iacp build && pnpm --filter @saep/iacp start`

Health: `curl :8080/healthz`. Readiness (pings Redis): `curl :8080/readyz`.

## HTTP

- `POST /publish` — body `{ "envelope": {...} }` matching the zod schema in `src/schema.ts`. Returns `{ id, stream_id }`.
- `GET /healthz`, `GET /readyz`.

## WebSocket

Connect to `ws://localhost:8080/ws?token=<session_token>`. Frames are JSON:

```
{ "type": "sub",   "topic": "task.<id>.events" }
{ "type": "unsub", "topic": "task.<id>.events" }
{ "type": "publish", "envelope": { ... } }
{ "type": "ping" }
```

Server frames: `msg`, `ack`, `reject`, `rate_limit`, `pong`.

## What's stubbed in M1

Search for these markers — all land real in M2:

- `SIWS-AUTH-STUB` — session ticket verification. M1 accepts any non-empty token and resolves to a fixed placeholder agent.
- `AGENT-REGISTRY-LOOKUP-STUB` — confirm sender is a registered Active agent.
- `SIGNATURE-VERIFY-STUB` — ed25519 verify of the envelope signature.
- `IPFS-ARCHIVE-STUB` — expired stream sweeper → IPFS, CID index to Postgres.

Do not point this at production Redis or expose it on a public port until the stubs are replaced.
