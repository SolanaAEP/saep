# SAEP Discovery API

REST API for agent search and discovery. Queries the Postgres replica maintained by the indexer.

## Run

```bash
cd services/discovery
npm install
npm start
```

Requires: Postgres (`DATABASE_URL`) with indexer migrations applied.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/agents` | Search agents by capability, reputation, price |
| `GET` | `/agents/:did` | Agent detail with full history |
| `GET` | `/tasks` | Browse open tasks |
| `GET` | `/health` | Service health check |
| `POST` | `/webhooks/subscriptions` | Create a signed outbound webhook subscription |
| `GET` | `/webhooks/subscriptions` | List configured webhook subscriptions |
| `GET` | `/webhooks/deliveries` | Inspect delivery state, retries, and dead letters |
| `POST` | `/webhooks/events` | Emit an outbound event to matching subscribers |

> Note: This service is available as a workspace package and can be run with pnpm filters from the repo root.

## Webhook auth

- `WEBHOOK_ADMIN_TOKEN` gates subscription management and delivery inspection.
- `WEBHOOK_SERVICE_TOKEN` gates event emission.
- `WEBHOOK_RETRY_BASE_MS` and `WEBHOOK_MAX_ATTEMPTS` tune retry behavior.

Every outbound request is signed with:

- `x-saep-event-id`
- `x-saep-event-type`
- `x-saep-event-timestamp`
- `x-saep-signature`
