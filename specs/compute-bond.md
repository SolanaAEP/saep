# compute-bond — DePIN-backed task escrow (io.net + Akash fallback)

Parent: `backlog/P2_depin_compute_bond.md`.
Thesis: a task bid from an agent is more credible if the agent has pre-reserved GPU compute that will be slashed (to the client, or to protocol treasury) if the agent fails to deliver. Two-sided lock: bond escrows USDC *and* reserves DePIN lease hours. Attacker cost = stake + compute opportunity cost, not stake alone.

## Providers

Primary: **io.net** — ships a Ray-based agent runtime, public lease API, GPU supply aligned with agent workloads.
Fallback: **Akash** — cheaper but requires SDL-based deployment, longer spin-up. Use when io.net unavailable or when category is low-latency-tolerant batch work.

Not Render — poor fit, consumer rather than API-first.

## On-chain surface (treasury_standard additions)

```rust
pub const MAX_BOND_DURATION_SECS: i64 = 14 * 24 * 3_600; // 14d
pub const MIN_BOND_USD_MICRO: u64 = 10_000_000;          // $10

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ComputeProvider { Ionet, Akash }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum BondStatus { Active, Released, Slashed, Expired }

#[account]
#[derive(InitSpace)]
pub struct ComputeBond {
    pub agent_did: [u8; 32],
    pub provider: ComputeProvider,
    pub lease_id: [u8; 32],          // provider-assigned handle (hashed)
    pub bond_mint: Pubkey,
    pub bond_amount: u64,            // USDC micro-units
    pub gpu_hours_reserved: u32,     // attested by broker signature
    pub capability_bits: u128,       // which capabilities this bond covers
    pub posted_at: i64,
    pub expires_at: i64,
    pub slashable_until: i64,        // bond slash-window post-expiry
    pub locked_to_task: Option<Pubkey>,
    pub broker_attestation: [u8; 64], // ed25519 sig by compute-broker over lease params
    pub status: BondStatus,
    pub bump: u8,
    pub escrow_bump: u8,
}
```

PDA: `[b"compute_bond", agent_did, posted_at.to_le_bytes()]`.
Escrow token account: `[b"bond_escrow", bond.key()]`.

### Instructions

| ix | signer | effect |
|---|---|---|
| `post_compute_bond` | agent operator | transfer USDC to escrow, verify broker signature over `(agent_did, provider, lease_id, gpu_hours, expires_at)`, create ComputeBond |
| `lock_bond_to_task` | task_market PDA (CPI) | binds bond to a specific task_id; set `locked_to_task`; other tasks can't consume same bond |
| `release_bond` | permissionless after task completed | if `locked_to_task` task == Released, status→Released, refund to agent |
| `slash_bond` | task_market PDA or dispute_arbitration PDA | status→Slashed, transfer escrow to slash destination (client or protocol) |
| `expire_bond` | permissionless after `slashable_until` | status→Expired, refund to agent |
| `renew_bond` | agent operator | extend `expires_at` by up to 14d, re-attest via broker signature |

### CPI graph (extends pre-audit 07 DAG)

```
task_market           → treasury_standard (lock_bond_to_task, slash_bond path)
dispute_arbitration   → treasury_standard (slash_bond)
treasury_standard     → token_program    (escrow transfers)
```

No new back-edges. No CPI to off-chain broker — the broker attestation is verified ed25519 inside `post_compute_bond`, brokers never sign a tx.

## Off-chain: services/compute-broker

Node/TS service. Lives alongside other services. Responsibilities:

1. **Lease reservation**: takes agent request `{provider, gpu_hours, duration, capability_hints}`, calls io.net `/leases/reserve` (or Akash SDL deploy for fallback), receives `lease_id`.
2. **Attestation**: signs `(agent_did, provider, lease_id, gpu_hours, expires_at)` with broker ed25519 key; returns signature to agent.
3. **Lock propagation**: subscribes to IACP `task.locked` events; when `task.bid_book_closed` fires with our agent as winner, calls provider to mark lease as active (io.net supports activation webhooks).
4. **Slash reclaim**: subscribes to `bond.slashed` events; on match, calls provider to reclaim the lease allocation back to protocol pool.
5. **Expiry sweep**: nightly, expires leases that passed `slashable_until`.

### Broker key model

- One protocol-level broker key = operational risk. Rotate weekly via governance ix `rotate_broker_key`.
- Broker key held in HSM / cloud KMS. Not hot-wallet.
- `treasury_standard::BondGlobal` stores the current + previous broker pubkey; previous honored for 48h to avoid in-flight race.

### API surface

```
POST /bonds/request
  body: { agent_did, provider, gpu_hours, duration_secs, capability_hints? }
  reply: { lease_id, attestation_sig, gpu_hours, expires_at, reserved_price_usd }

POST /bonds/cancel
  body: { lease_id, agent_did, signed_request }
  reply: { refund_amount, status }

GET /leases/:id
GET /healthz
GET /metrics
```

## Eligibility check in task_market

`task_market::commit_bid` on compute-heavy category:

1. Load `ComputeBond` PDA referenced in bid args.
2. Assert `bond.status == Active`, `now < bond.expires_at`, bond covers `payload.capability_bit` via `capability_bits` mask.
3. Assert `bond.bond_amount >= task.required_bond_usd` (governance-configured per capability).
4. Assert `bond.locked_to_task.is_none() || bond.locked_to_task == Some(task_id)`.

Category bond requirements per capability bit maintained in `capability_registry::CapabilityTag.min_bond_usd`.

## Settlement interaction

- Task releases normally → `release_bond` callable, refund to agent.
- Task expires unfinished → `slash_bond` with destination = client (make client whole for compute wasted).
- Task dispute resolved against agent → `slash_bond` with destination = protocol treasury + partial to client (bps-configurable).
- Task dispute resolved for agent → bond released.

## Gaming vectors + mitigations

| vector | mitigation |
|---|---|
| fake lease_id (no real compute reserved) | broker signature required; broker verified against real provider API |
| compromise broker key | weekly rotation, HSM custody, 48h grace on old key |
| bond re-use across N simultaneous tasks | `locked_to_task` set atomically; single-bind |
| agent cancels lease off-chain after bond posted | broker attestation carries TTL; slashing window lets protocol slash even if agent pulls lease |
| broker signs for non-existent lease | reviewer audit of broker code; distinct broker role from protocol authority |

## Metrics

`compute_bond_active_usd`, `compute_bond_slashed_total`, `lease_reservation_latency_seconds{provider}`, `lease_cancellation_total{reason}`.

## Phased rollout

- **M2**: post_compute_bond + broker service + manual lock/slash; no task_market enforcement yet.
- **M3**: capability-level enforcement, dispute integration, Akash fallback.
- **M4**: auction-based pricing for bond requirements per category.

## Tests

- unit: bond state transitions, broker signature verify.
- integration: localnet task with mocked broker, assert slash routes correctly on expire + dispute paths.
- provider integration: staging io.net lease lifecycle (manual verification pre-M2).

## Non-goals (M2)

- Non-GPU compute bonding (CPU-only workloads) — out of scope; re-spec if demand.
- Provider-issued yield on idle bond capital — M4.
- Automated provider arbitrage — off-scope.
