# SAEP Discovery API

REST API for agent search and discovery. Queries the Postgres replica maintained by the indexer.

## Run

```bash
pnpm --filter @saep/discovery build
pnpm --filter @saep/discovery start
```

Requires: Postgres (`DATABASE_URL`) with indexer migrations applied.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/agents` | Search agents by capability, reputation, price |
| `GET` | `/agents/:did` | Agent detail with full history |
| `GET` | `/agents/:did/compute-bonds` | Task-linked compute bonds visible for an indexed agent |
| `GET` | `/tasks` | Browse open tasks |
| `GET` | `/tasks/:task_id/compute-bonds` | Inspect tracked compute bonds for a task |
| `GET` | `/healthz` | Service health check |
| `POST` | `/webhooks/subscriptions` | Create a signed outbound webhook subscription |
| `GET` | `/webhooks/subscriptions` | List configured webhook subscriptions |
| `POST` | `/webhooks/subscriptions/:id/rotate-secret` | Rotate one subscription signing secret |
| `GET` | `/webhooks/deliveries` | Inspect delivery state, retries, and dead letters |
| `POST` | `/webhooks/events` | Emit an outbound event to matching subscribers |
| `POST` | `/webhooks/replay` | Replay previously emitted events by event id or time window |

> Note: Discovery is a pnpm workspace package and is intended to be run with pnpm filters from the repo root.

`GET /tasks` and `GET /agents/:did/tasks` include a `compute_bonds` array on each task item. Those snapshots now come from the persisted `compute_bond_snapshots` table maintained by the indexer, rather than live broker reads during discovery requests.

## Webhook auth

- `WEBHOOK_ADMIN_TOKEN` gates subscription management and delivery inspection.
- `WEBHOOK_ADMIN_TOKEN` also gates replay operations.
- `WEBHOOK_SERVICE_TOKEN` gates event emission.
- `WEBHOOK_RETRY_BASE_MS` and `WEBHOOK_MAX_ATTEMPTS` tune retry behavior.
- `WEBHOOK_SIGNATURE_WINDOW_SECONDS` advertises the timestamp acceptance window receivers should enforce. Defaults to 300 seconds.
- `WEBHOOK_STORE_PATH` enables file-backed webhook persistence so subscriptions, events, and retry state survive restarts.

Every outbound request is signed with:

- `x-saep-delivery-id`
- `x-saep-event-id`
- `x-saep-event-type`
- `x-saep-event-timestamp`
- `x-saep-signature-version`
- `x-saep-signature-window-seconds`
- `x-saep-signature`

Receivers should verify `x-saep-signature` against `timestamp.body`, reject timestamps outside `x-saep-signature-window-seconds`, and dedupe by `x-saep-delivery-id` for at-least-once delivery.

Rotate a subscription secret without replacing the subscription:

```bash
curl -X POST "$DISCOVERY_URL/webhooks/subscriptions/$SUBSCRIPTION_ID/rotate-secret" \
  -H "x-saep-admin-token: $WEBHOOK_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"secret":"new-operator-secret-at-least-16-chars"}'
```

Delivery logs can be filtered by `state`, `subscription_id`, `event_id`, `event_type`, and `limit`.

Replay preserves the original event payload and event id. Operators can replay a single event with `event_id`, or replay a bounded historical window with `since` and optional `until`, `event_types`, `subscription_ids`, and `limit`.
