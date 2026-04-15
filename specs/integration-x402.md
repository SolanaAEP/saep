# integration-x402 — HTTP payment rail over SAEP

Parent: `backlog/P1_protocol_integrations_x402_mcp_sak.md` §x402.
x402 spec: `HTTP/1.1 402 Payment Required` with a `X-PAYMENT` header carrying a payload the client signs + returns. SAEP role: be both a consumer (agents pay other x402 endpoints) and a provider (SAEP endpoints charge x402 callers). Settlement terminates in `task_market::release` on Solana.

## Service

`services/x402-gateway/` — new package. Fastify server, TypeScript.

Responsibilities:
1. **Outbound proxy**: agents POST `/proxy` with `{target_url, method, body, budget, mint}`. Gateway issues the outbound HTTP; on 402, signs payment authorization with agent operator key held in KMS/HSM; retries once; returns final response + settlement receipt.
2. **Inbound facilitator**: SAEP-hosted paid endpoints (`apps/portal`, `apps/docs` paid-tier) emit 402 with SAEP scheme; gateway validates returned `X-PAYMENT` and returns settled bool.
3. **Bridge**: when caller pays from an EVM chain, use Circle CCTP v2 to route USDC to Solana target treasury. CCTP attestation wait bounded; fallback to reject if > 90s.

## Payment scheme

Gateway speaks two x402 schemes:
- `exact` (x402 default): signed EIP-712 authorization (EVM) or ed25519 over canonical message (SVM). SAEP-native path prefers SVM.
- `cctp-usdc`: cross-chain fallback for EVM senders. Message format `{source_domain, dest_domain=solana, amount, recipient, nonce}`.

## On-chain binding

No program change required. Gateway calls `task_market::create_task` + `fund_task` + `submit_result` + `release` in one bundle (Jito, per pre-audit 06). Task is ephemeral single-shot: `payload.kind = DataFetch` or `Generic` with `args_hash = sha256(request_canonical)`.

## Auth + rate limit

- Outbound proxy requires agent operator signature on request body (same ed25519 rail as IACP).
- Rate limit per agent_did: 100 req/min, 10k req/day (configurable). Storage: redis token bucket.
- Budget field: max total lamports agent authorizes across retries; gateway refuses to exceed.

## Surface

```
POST /proxy
  body: { target_url, method, headers?, body?, budget_lamports, mint }
  reply: { status, body, payment_receipts: [{ tx_sig, amount, mint }] }

POST /facilitate/verify
  body: { x_payment, resource_ref }
  reply: { ok, settled_tx_sig? }

GET  /healthz
GET  /metrics
```

## Failure modes

| failure | policy |
|---|---|
| upstream returns 402 twice | abort; return 402 to caller with gateway summary |
| CCTP attestation > 90s | abort; refund |
| insufficient budget | 400 to caller |
| signature invalid | 401 |
| target_url hostname not in allow-config | 403 (kills open-proxy abuse) |

`target_url` allow-config: either full allowlist (locked-down) or TLD/domain pattern (looser). Default: pattern `*.saep.example` + explicit list of x402-compliant partners.

## Tests

- unit: signature verify, budget enforcement, CCTP timeout math
- integration: localnet task_market; mock upstream emitting 402 with known scheme
- e2e: devnet task_market + real x402 demo endpoint (Coinbase demo if available)

## Non-goals

- L1 EVM settlement — always bridge to SVM via CCTP or reject.
- Arbitrary token pairs — USDC-only for M1.
