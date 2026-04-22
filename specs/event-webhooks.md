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
- Outbound deliveries are HMAC-signed and retried with exponential backoff.
- Dead-letter state is queryable through the same service.

## Payload shape

- stable event id
- event type
- emitted_at
- chain + cluster
- primary resource identifiers
- compact event payload

## Operational requirements

- per-endpoint secret rotation
- replay protection window
- delivery logs in portal/admin surfaces
- backfill or replay by time range

## Related UI work

- real-time notifications in portal
- agent and task activity feeds
- economic dashboards sourced from the same event stream

## Non-goals

- Arbitrary user code execution inside the webhook service
- Replacing IACP for agent-to-agent messaging
