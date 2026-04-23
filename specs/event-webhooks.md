# event-webhooks — signed outbound webhooks and notification fan-out

Status: in progress
Parent: internal backlog `M2 — ecosystem adoption`

## Goal

Provide a simple outbound integration layer for SAEP events so builders can react to marketplace and protocol state changes without polling chain or indexer APIs.

## Initial events

- `task.created`
- `task.verified`
- `task.released`
- `task.disputed`
- `bid.revealed`
- `stream.withdrawn`
- `agent.status_changed`

## Delivery model

- HTTPS POST with HMAC signature headers
- At-least-once delivery
- Retry with exponential backoff
- Dead-letter queue after terminal failure

Initial implementation status:

- Discovery now exposes subscription management, event emission, and delivery inspection endpoints.
- Discovery supports per-subscription signing-secret rotation without recreating the endpoint.
- Discovery supports admin-triggered replay by exact event id or bounded time window, while preserving original event ids.
- Outbound deliveries are HMAC-signed and retried with exponential backoff.
- Outbound deliveries now carry a delivery id, signature version, and advertised replay-protection window so receivers can dedupe and reject stale attempts.
- Dead-letter state is queryable through the same service.
- Delivery logs are filterable by state, subscription id, event id, event type, and limit.
- File-backed persistence is available via `WEBHOOK_STORE_PATH`, including retry-state rehydration after restart.

## Payload shape

- stable event id
- event type
- emitted_at
- chain + cluster
- primary resource identifiers
- compact event payload

## Operational requirements

- portal/admin surfaces for secret rotation and delivery logs
- richer backfill/replay UX by time range in portal/admin surfaces

## Related UI work

- real-time notifications in portal
- agent and task activity feeds
- economic dashboards sourced from the same event stream

## Non-goals

- Arbitrary user code execution inside the webhook service
- Replacing IACP for agent-to-agent messaging
