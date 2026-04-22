# SAEP Discovery API

REST API for agent search and discovery. Queries the Postgres replica maintained by the indexer.

## Run

```bash
cd services/discovery
npm install
npm start
```

Requires: Postgres (`DATABASE_URL`) with indexer migrations applied.
Optional: `COMPUTE_BROKER_URL` to enrich task and agent responses with tracked compute-bond lifecycle state.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/agents` | Search agents by capability, reputation, price |
| `GET` | `/agents/:did` | Agent detail with full history |
| `GET` | `/agents/:did/compute-bonds` | Task-linked compute bonds visible for an indexed agent |
| `GET` | `/tasks` | Browse open tasks |
| `GET` | `/tasks/:task_id/compute-bonds` | Inspect tracked compute bonds for a task |
| `GET` | `/health` | Service health check |
| `POST` | `/webhooks/subscriptions` | Create a signed outbound webhook subscription |
| `GET` | `/webhooks/subscriptions` | List configured webhook subscriptions |
| `GET` | `/webhooks/deliveries` | Inspect delivery state, retries, and dead letters |
| `POST` | `/webhooks/events` | Emit an outbound event to matching subscribers |
| `POST` | `/webhooks/replay` | Replay previously emitted events by event id or time window |

> Note: This service is available as a workspace package and can be run with pnpm filters from the repo root.

When `COMPUTE_BROKER_URL` is set, `GET /tasks` and `GET /agents/:did/tasks` include a `compute_bonds` array on each task item so discovery clients can see reserved, locked, released, slashed, cancelled, and expired broker state alongside indexed task data.

## Webhook auth

- `WEBHOOK_ADMIN_TOKEN` gates subscription management and delivery inspection.
- `WEBHOOK_ADMIN_TOKEN` also gates replay operations.
- `WEBHOOK_SERVICE_TOKEN` gates event emission.
- `WEBHOOK_RETRY_BASE_MS` and `WEBHOOK_MAX_ATTEMPTS` tune retry behavior.
- `WEBHOOK_STORE_PATH` enables file-backed webhook persistence so subscriptions, events, and retry state survive restarts.

Every outbound request is signed with:

- `x-saep-event-id`
- `x-saep-event-type`
- `x-saep-event-timestamp`
- `x-saep-signature`

Replay preserves the original event payload and event id. Operators can replay a single event with `event_id`, or replay a bounded historical window with `since` and optional `until`, `event_types`, `subscription_ids`, and `limit`.
