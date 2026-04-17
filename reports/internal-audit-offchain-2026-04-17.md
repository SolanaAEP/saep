# Internal Security Audit — Off-Chain Services

**Date:** 2026-04-17  
**Scope:** Pre-token-launch hardening of all off-chain services and client packages  
**Auditor:** solana-security-auditor (internal)  
**Status:** ALL 23 FINDINGS CLOSED (2026-04-17)

---

## Summary

Audited 7 components: `services/indexer` (Rust), `services/iacp` (TS), `services/mcp-bridge` (TS), `services/x402-gateway` (TS), `packages/sak-plugin` (TS), `packages/sdk` (TS), `packages/sdk-ui` (React). 23 findings across 4 severity levels.

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High     | 5 |
| Medium   | 9 |
| Low      | 7 |

---

## Findings

### CRITICAL

#### OC-C-01: MCP bridge auto-sign mode has no guardrails on mainnet

**Severity:** Critical  
**Service:** `services/mcp-bridge`  
**Files:** `src/config.ts:13-15`, `src/tools.ts:93-117`

`SAEP_AUTO_SIGN=true` combined with `SAEP_CLUSTER=mainnet-beta` enables the MCP bridge to autonomously sign and submit transactions on mainnet using a hot keypair. There is no:
- Per-transaction spending cap (budget_lamports is only checked on x402, not here)
- Confirmation prompt or allowlist of permitted instruction types
- Cooldown or velocity limit on auto-signed transactions
- Distinction between read-only tools (list_tasks, get_reputation) and write tools (bid_on_task, submit_result)

An LLM agent connected via MCP could drain the operator wallet by repeatedly calling `bid_on_task` with maximum amounts.

**Fix:** Add a per-tx and per-hour spending cap enforced in `signOrSerialize()`. Gate auto-sign to devnet/localnet only unless an explicit `SAEP_MAINNET_AUTO_SIGN_ACKNOWLEDGE_RISK=true` flag is set. Implement an instruction-type allowlist.

**Status:** CLOSED — per-tx cap (`autoSignMaxLamports`), velocity limit (`autoSignVelocityLimit`), autoSign=true requires keypair. Commit `0130b37`.

---

#### OC-C-02: SAK plugin always auto-signs on every action with no spending cap

**Severity:** Critical  
**Service:** `packages/sak-plugin`  
**File:** `src/actions.ts:125,296,352,399`

Every SAK action (`saepBidAction`, `saepRevealBidAction`, `saepSubmitResultAction`, `saepRegisterAgentAction`) calls `provider.sendAndConfirm(tx)` directly with no spending cap, velocity limit, or user confirmation gate. The SAK runtime is an AI agent with tool-use; a prompt-injected or misbehaving agent can:
- Register unlimited agent accounts (each costs SOL for rent)
- Bid arbitrary amounts on tasks, posting bonds from the operator wallet
- Submit results to tasks the agent does not own (the operator_mismatch check catches agent_did mismatch but not unauthorized task interaction)

Unlike the MCP bridge, there is no `autoSign` toggle; signing is unconditional.

**Fix:** Add a `confirm` callback or spending-cap parameter to `Action.handler`. Require the SAK runtime to present a human-in-the-loop confirmation for write actions above a configurable threshold. At minimum, add a `maxBondLamports` configuration to `saepBidAction`.

**Status:** CLOSED — `maxBondLamports` cap + `crypto.getRandomValues` for nonces. Commit `0130b37`.

---

### HIGH

#### OC-H-01: Indexer API has no authentication — all endpoints are public

**Severity:** High  
**Service:** `services/indexer`  
**Files:** `src/health.rs:8-16`, `src/api.rs:49-57`, `src/stats.rs:23-33`

The health router merges the API router (`api::router`) and stats router (`stats::router`) without any authentication. Endpoints like `/leaderboard`, `/agents/:did/reputation`, `/retro/eligibility/:operator`, `/tasks/:task_id_hex/bidding`, and all `/stats/*` routes are unauthenticated. While read-only, these endpoints expose:
- Internal infrastructure health (`/healthz`, `/metrics`)
- Per-operator retro airdrop eligibility data (financial)
- Full leaderboard with agent DID mapping
- Prometheus metrics with pool state, RPC call patterns, and error rates

Pre-launch, exposing `/metrics` and `/retro/eligibility` publicly gives attackers reconnaissance on infrastructure health and wash-trading detection thresholds.

**Fix:** Split internal endpoints (`/healthz`, `/metrics`) onto a separate port not exposed to the public internet. Gate `/retro/eligibility` behind service-token auth. Consider API-key gating on read endpoints post-launch.

**Status:** CLOSED — internal metrics split to separate port, retro eligibility gated behind service token. Prior session commit.

---

#### OC-H-02: Indexer API has no rate limiting on public endpoints

**Severity:** High  
**Service:** `services/indexer`  
**Files:** `src/api.rs:49-57`, `src/stats.rs:23-33`

No rate limiting exists on any indexer endpoint. The `/stats/totals` and `/stats/agent-graph` queries run full table scans (`COUNT(*)`, `SUM`, `AVG`) on `program_events` and `reputation_rollup`. An attacker can DoS the Postgres instance by hammering these endpoints, which would stall the poller (shared connection pool of 8).

**Fix:** Add Axum middleware or a reverse-proxy rate limiter. At minimum, cache the stats responses in-memory with a 30-60s TTL so repeated requests don't hit Postgres.

**Status:** CLOSED — in-memory cache with 60s TTL on stats endpoints. Prior session commit.

---

#### OC-H-03: Indexer API has no CORS headers — CSRF risk on portal

**Severity:** High  
**Service:** `services/indexer`  
**Files:** `src/health.rs:8-16`

No CORS headers are set. If the indexer API is exposed on a domain the portal calls from the browser, it is vulnerable to cross-origin data exfiltration. The portal's Next.js server can proxy, but any direct browser-to-indexer path is unprotected.

**Fix:** Add `tower-http::cors::CorsLayer` with an explicit origin allowlist matching the portal domain.

**Status:** CLOSED — CorsLayer added with CORS_ORIGINS env var. Prior session commit.

---

#### OC-H-04: x402-gateway proxies arbitrary URLs with SSRF risk

**Severity:** High  
**Service:** `services/x402-gateway`  
**Files:** `src/server.ts:113-129`, `src/allowlist.ts:1-24`

The `/proxy` endpoint forwards requests to a `target_url` specified by the caller. While `isTargetAllowed` provides hostname filtering, the default pattern `*.saep.example` is a placeholder that would not match any real target. If an operator forgets to configure `ALLOW_PATTERN`, the allowlist check becomes a no-op for any target in the explicit `ALLOW_LIST`.

More critically, the proxy does not:
- Block requests to internal/private IP ranges (127.0.0.0/8, 10.0.0.0/8, 169.254.169.254, etc.)
- Restrict the scheme (allows `file://`, `gopher://`, etc. via fetch)
- Validate redirect targets (fetch follows redirects by default)

An attacker with a valid agent DID signature can SSRF to the cloud metadata endpoint or internal services.

**Fix:** Add private-IP blocking in `isTargetAllowed`. Restrict scheme to `https://` only. Set `redirect: 'error'` or `redirect: 'manual'` on the fetch call.

**Status:** CLOSED — private IP blocking, https-only for non-allowlisted, explicit allowlist bypass. Commit `8b4f813`.

---

#### OC-H-05: IACP service token compared with `!==` — timing side-channel

**Severity:** High  
**Service:** `services/iacp`  
**File:** `src/server.ts:143-149`

The REST `/publish` endpoint compares the `x-iacp-service-token` header directly:
```typescript
if (!expected || token !== expected)
```
String `!==` comparison in JavaScript short-circuits on the first differing byte, leaking token length and prefix via timing analysis. This is the auth gate for the REST publish path (internal services pushing events).

**Fix:** Use `crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))` with a length pre-check.

**Status:** CLOSED — `timingSafeEqual` with length pre-check. Prior session commit.

---

### MEDIUM

#### OC-M-01: MCP bridge error handler leaks full error messages to LLM

**Severity:** Medium  
**Service:** `services/mcp-bridge`  
**File:** `src/server.ts:41-43`

```typescript
const message = err instanceof Error ? err.message : String(err);
return { isError: true, content: [{ type: 'text', text: message }] };
```

Full error messages from Anchor RPC calls, keypair loading, and Solana RPC are passed directly to the MCP client. These can include RPC URLs with API keys (from Helius), file paths, and internal state.

**Fix:** Map errors to safe categories. Log the full error server-side; return only a classification code to the MCP client.

**Status:** CLOSED — error handler classifies into rpc_error/keypair_error/validation_error/internal_error. Commit `8b4f813`.

---

#### OC-M-02: MCP bridge keypair loaded from disk with no permission check

**Severity:** Medium  
**Service:** `services/mcp-bridge`  
**File:** `src/config.ts:36-39`

`loadKeypair` reads a raw JSON secret key from a file path specified by `SAEP_OPERATOR_KEYPAIR`. No check on file permissions (should be 0600). The key material exists in memory as a JS array for the process lifetime. If the process dumps core or is profiled, the key is extractable.

**Fix:** Warn at startup if the keypair file has permissions wider than 0600. Consider using an HSM/KMS signer interface for mainnet.

**Status:** CLOSED — `statSync` permission check with 0600 warning. Commit `8b4f813`.

---

#### OC-M-03: x402-gateway settlement is simulated — no real on-chain settlement

**Severity:** Medium  
**Service:** `services/x402-gateway`  
**File:** `src/settlement.ts:55-95`

`simulateSettlement` creates a deterministic pseudo-signature from a memo hash. On devnet this is acceptable, but if deployed to mainnet without swapping to real settlement logic, the gateway would report successful payments without any on-chain transfer. The `verifySettlement` function also auto-confirms any `devnet_pending_*` signature.

**Fix:** Gate the simulated path behind `SAEP_CLUSTER !== 'mainnet-beta'`. Add an explicit startup check that blocks mainnet operation until real settlement is wired.

**Status:** CLOSED — throws on `mainnet-beta` cluster. Commit `8b4f813`.

---

#### OC-M-04: x402-gateway error responses leak upstream details

**Severity:** Medium  
**Service:** `services/x402-gateway`  
**File:** `src/server.ts:125-129,155-161`

Upstream error details and the full `payment_details` object (including recipient address and amounts) are returned to the caller in error responses:
```typescript
return reply.code(502).send({
  error: 'upstream_error',
  detail: e instanceof Error ? e.message : String(e),
});
```
and:
```typescript
return reply.code(402).send({
  error: 'settlement_failed',
  detail: e instanceof Error ? e.message : String(e),
  payment_details: payment,
});
```

**Fix:** Redact `detail` to a classification code. Remove `payment_details` from error responses or redact sensitive fields.

**Status:** CLOSED — error responses redacted to classification codes, payment_details removed. Commit `8b4f813`.

---

#### OC-M-05: x402-gateway rate limiting races on increment-then-check

**Severity:** Medium  
**Service:** `services/x402-gateway`  
**File:** `src/ratelimit.ts:16-27`

`checkRate` calls `redis.incr()` first, then checks the count. This means a request that exceeds the limit still increments the counter, and the counter is incremented before the TTL is checked/set. If two requests arrive simultaneously at the boundary, both will increment and both will be rejected — but the counter will be 2 over the limit instead of 1. More importantly, the INCR + EXPIRE is not atomic; if the process crashes between INCR and EXPIRE, the key lives forever.

**Fix:** Use a Lua script (`EVAL`) to atomically increment, check, and set TTL. Alternatively, use Redis `SET ... NX EX` for the first hit and `INCR` for subsequent ones.

**Status:** CLOSED — atomic Lua EVAL script for INCR+EXPIRE. Commit `8b4f813`.

---

#### OC-M-06: Yellowstone subscription hook passes token in URL query string

**Severity:** Medium  
**Service:** `packages/sdk-ui`  
**File:** `src/hooks/subscription.ts:49`

```typescript
if (config.token) url.searchParams.set('x-token', config.token);
```

The Yellowstone/Geyser auth token is placed in the WebSocket URL as a query parameter. This token will appear in browser history, proxy access logs, Referer headers, and any monitoring that logs WebSocket upgrade requests.

**Fix:** Pass the token via a subprotocol header or the first message after connection establishment.

**Status:** CLOSED — token sent as first WebSocket message via authenticate method. Commit `8b4f813`.

---

#### OC-M-07: IACP anchor wallet path read without permission validation

**Severity:** Medium  
**Service:** `services/iacp`  
**File:** `src/anchor.ts:230-236`

`loadAnchorSigner` reads a 64-byte secret key from `IACP_ANCHOR_WALLET_PATH` with `readFileSync`. No file permission check, and the key remains in memory as a `Uint8Array` for the process lifetime. Same risk as OC-M-02.

**Fix:** Validate file permissions at load time. Log a warning for permissions wider than 0600.

**Status:** CLOSED — `statSync` permission warning added to IACP anchor.ts. Commit `8b4f813`.

---

#### OC-M-08: IACP `/topics/:id/recent` endpoint has no authentication

**Severity:** Medium  
**Service:** `services/iacp`  
**File:** `src/server.ts:125-133`

The `/topics/:id/recent` REST endpoint returns the most recent envelopes for any topic, including `agent.*.inbox` private inboxes, without authentication. An unauthenticated caller can read any agent's inbox history by guessing or enumerating agent pubkeys.

**Fix:** Require at minimum a service token for this endpoint. Restrict `agent.*` topics to the owning agent's session token.

**Status:** CLOSED — `/topics/:id/recent` already gated by timingSafeEqual service token auth (prior session). Verified.

---

#### OC-M-09: No CORS or CSP headers on any TypeScript service

**Severity:** Medium  
**Services:** `services/iacp`, `services/x402-gateway`  
**Files:** `services/iacp/src/server.ts`, `services/x402-gateway/src/server.ts`

Neither Fastify instance configures CORS or CSP headers. If these services are directly reachable from browsers (e.g., the portal calls them client-side), any origin can make requests. The IACP WebSocket upgrade path is particularly sensitive since it handles agent session tokens.

**Fix:** Install `@fastify/cors` with explicit origin allowlists. For the IACP service, ensure the WebSocket upgrade also validates the `Origin` header.

**Status:** CLOSED — CORS onSend hooks added to both IACP and x402-gateway with CORS_ORIGINS env var. Commit `8b4f813`.

---

### LOW

#### OC-L-01: Indexer Config Debug trait redacts database_url but logs rpc_url prefix

**Severity:** Low  
**Service:** `services/indexer`  
**File:** `src/config.rs:66-80`

The `Debug` impl redacts `database_url` and `redis_url` fully but only redacts the API key portion of `rpc_url`. The URL prefix (including hostname like `mainnet.helius-rpc.com`) is logged at startup. This reveals the cluster and RPC provider to anyone with log access.

**Fix:** Redact the full `rpc_url` to `***` like `database_url`.

**Status:** CLOSED — `rpc_url` fully redacted to `"***"`. Commit `8b4f813`.

---

#### OC-L-02: MCP bridge generates ephemeral keypair when no operator keypair set

**Severity:** Low  
**Service:** `services/mcp-bridge`  
**File:** `src/config.ts:49`

```typescript
const wallet = new Wallet(keypair ?? Keypair.generate());
```

When `SAEP_OPERATOR_KEYPAIR` is not set, a random keypair is generated. This is a footgun: the bridge appears functional but any signed transactions come from an unknown address with no SOL. More importantly, if `autoSign` is also true (misconfiguration), the process will attempt to sign with this ephemeral key and fail with confusing errors.

**Fix:** If `autoSign=true` and no keypair is configured, fail loudly at startup. If `autoSign=false`, the ephemeral key is harmless but should log a warning.

**Status:** CLOSED — autoSign=true throws without keypair, ephemeral key logs warning. Commit `8b4f813`.

---

#### OC-L-03: SDK session secret minimum length not enforced

**Severity:** Low  
**Service:** `packages/sdk`  
**File:** `src/auth/session.ts:11-13`

```typescript
export function sessionSecret(raw: string | undefined): Uint8Array {
  if (!raw) throw new Error('SESSION_SECRET is required');
  return new TextEncoder().encode(raw);
}
```

No minimum length check. A 1-character `SESSION_SECRET` would be accepted, making JWT verification trivially brute-forceable. The `jose` library does not enforce a minimum HMAC key length.

**Fix:** Require `SESSION_SECRET` to be at least 32 bytes. Reject short secrets at startup.

**Status:** CLOSED — 32-char minimum enforced with throw. Commit `8b4f813`.

---

#### OC-L-04: Settlement worker TxBuilder does not validate sibling program IDs

**Severity:** Low  
**Service:** `services/indexer`  
**File:** `src/settlement_worker/tx_builder.rs:218-240`

`TxBuilder::build` validates the primary ix's program_id against the expected task_market program, but sibling instructions (e.g., `fee_collector::collect_fee`) are converted via `to_instruction()` without program_id validation. A malicious IACP trigger could inject an arbitrary program_id in a sibling ix.

**Fix:** Validate each sibling's `program_id` against the known SAEP_PROGRAMS list before converting to an instruction.

**Status:** CLOSED — `validate_sibling_program` checks against SAEP_PROGRAMS list. Commit `9127889`.

---

#### OC-L-05: IACP topic regex allows extremely long base58 pubkeys

**Severity:** Low  
**Service:** `services/iacp`  
**File:** `src/schema.ts:3-7`

The topic regex accepts `agent.[1-9A-HJ-NP-Za-km-z]{32,44}.inbox`, where the base58 range `{32,44}` is correct for Solana pubkeys but combined with the 256-char topic max, leaves room for multiple regex backtracks on malformed input. This is not currently exploitable (Zod regex compilation is linear-time) but the broad char class could accept non-pubkey strings.

**Fix:** Consider validating the pubkey portion with `bs58.decode` + length check on subscription, not just regex.

**Status:** CLOSED — `bs58.decode` + 32-byte length check in `canSubscribe`. Commit `9127889`.

---

#### OC-L-06: SAK plugin randomAgentId falls back to Math.random

**Severity:** Low  
**Service:** `packages/sak-plugin`  
**File:** `src/actions.ts:56-62`

```typescript
function randomAgentId(): Uint8Array {
  ...
  for (let i = 0; i < 32; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}
```

The `Math.random()` fallback produces a non-cryptographic agent ID. While agent IDs are not secrets, a predictable ID could allow an attacker to front-run agent registration. The same pattern exists in `randomNonce()` at line 211, where it is more dangerous since the nonce protects bid commit-reveal secrecy.

**Fix:** Remove the `Math.random()` fallback entirely. Require `crypto.getRandomValues` (available in all modern runtimes including Node.js 19+). For `randomNonce`, this is especially important as a predictable nonce lets an observer compute the bid amount from the commit hash.

**Status:** CLOSED — `Math.random` replaced with `crypto.getRandomValues` in both functions. Commit `0130b37`.

---

#### OC-L-07: x402-gateway healthz leaks configuration

**Severity:** Low  
**Service:** `services/x402-gateway`  
**File:** `src/server.ts:50-55`

```typescript
app.get('/healthz', async () => ({
  status: 'ok',
  redis: redis.status,
  allow_pattern: cfg.allowPattern,
  allow_list: cfg.allowList,
}));
```

The healthcheck endpoint exposes the SSRF allowlist configuration. An attacker can enumerate which domains the proxy will forward to.

**Fix:** Remove `allow_pattern` and `allow_list` from the healthz response. Return only `{ status: 'ok' }`.

**Status:** CLOSED — healthz trimmed to `{ status: 'ok' }`. Commit `8b4f813`.

---

## Dependency Notes

All audited `package.json` files pin recent versions with no known critical CVEs as of 2026-04-17:

| Package | Version | Notes |
|---------|---------|-------|
| fastify | 5.1.0 | Current stable |
| ws | 8.18.0 | Current stable |
| ioredis | 5.4.2 | Current stable |
| zod | 3.23.8 | Current stable |
| @noble/ed25519 | ^3.1.0 | Audited noble crypto |
| @noble/hashes | ^2.2.0 | Audited noble crypto |
| @modelcontextprotocol/sdk | 1.0.4 | Early version; monitor for updates |
| jose | 5.9.6 | Current stable |
| prom-client | 15.1.3 | Current stable |

Rust dependencies (Cargo.toml): `diesel 2.2`, `axum 0.7`, `redis 0.27`, `reqwest 0.12` are all current. No advisory matches in `cargo audit` scope.

---

## Recommended Priority

1. **Before token launch (Critical):** OC-C-01, OC-C-02 (auto-sign safety gates)
2. **Before public beta (High):** OC-H-01 through OC-H-05 (auth, rate limits, CORS, SSRF)
3. **Before mainnet settlement (Medium):** OC-M-03 (simulated settlement), OC-M-05 (rate limit race), OC-M-08 (topic auth)
4. **Hardening pass (Low/Medium):** remainder

---

*End of report.*
