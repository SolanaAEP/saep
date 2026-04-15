# Pre-audit 02 — commit-reveal bidding

Parent: `backlog/P0_pre_audit_hardening.md` item 2.
Threats: auction front-running, Sybil spam on open bid books, last-look sniping after competitor bids visible. Current repo has no bid ix at all — `create_task` → `fund_task` → direct `submit_result` assumes assignment is off-chain. Pre-M1 we bind assignment on-chain behind a commit-reveal window so auditors see a closed protocol, not a trust-me orchestrator.

## On-chain additions (task_market)

### Accounts

```rust
pub const MAX_BIDDERS_PER_TASK: u16 = 64;
pub const DEFAULT_COMMIT_WINDOW_SECS: i64 = 300;  // 5m
pub const DEFAULT_REVEAL_WINDOW_SECS: i64 = 180;  // 3m
pub const MIN_BID_BOND_BPS: u16 = 50;  // 0.5% of task payment
pub const MAX_BID_BOND_BPS: u16 = 500; // 5% cap

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum BidPhase { Commit, Reveal, Settled, Cancelled }

#[account]
#[derive(InitSpace)]
pub struct BidBook {
    pub task_id: [u8; 32],
    pub commit_start: i64,
    pub commit_end: i64,
    pub reveal_end: i64,
    pub bond_amount: u64,           // absolute, computed at open-time
    pub bond_mint: Pubkey,          // = task.payment_mint
    pub commit_count: u16,
    pub reveal_count: u16,
    pub winner_agent: Option<Pubkey>,
    pub winner_amount: u64,
    pub phase: BidPhase,
    pub bump: u8,
    pub escrow_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Bid {
    pub task_id: [u8; 32],
    pub agent_did: [u8; 32],
    pub bidder: Pubkey,             // signer/operator
    pub commit_hash: [u8; 32],      // keccak(amount_le || nonce || agent_did)
    pub bond_paid: u64,
    pub revealed_amount: u64,       // 0 until reveal
    pub revealed: bool,
    pub refunded: bool,
    pub slashed: bool,
    pub bump: u8,
}
```

PDAs:
- `BidBook`: `[b"bid_book", task_id]`
- `Bid`: `[b"bid", task_id, bidder.key()]`
- Bond escrow (token account): `[b"bond_escrow", task_id]` — owned by BidBook PDA.

### Instructions

| ix | signer | args | effect |
|---|---|---|---|
| `open_bidding` | client (task.client) | `commit_secs, reveal_secs, bond_bps` | init BidBook, enforce task.status == Funded, set windows, lock bond params |
| `commit_bid` | agent operator | `commit_hash: [u8;32]` | transfer bond to escrow, create Bid, `commit_count += 1` |
| `reveal_bid` | agent operator | `amount: u64, nonce: [u8;32]` | hash-match, set revealed_amount, `reveal_count += 1` |
| `close_bidding` | permissionless after `reveal_end` | — | pick winner (lowest `revealed_amount`; tie-break by highest `agent.stake_weight` then smallest pubkey), bind to TaskContract, phase = Settled |
| `claim_bond` | each bidder | — | if revealed → refund; if not revealed → slash (bond goes to fee_collector), phase must be Settled |
| `cancel_bidding` | client | — | only if `commit_count == 0` and `now < commit_end`; refunds noop |

### TaskContract link

- `TaskContract` gains `pub bid_book: Option<Pubkey>` and `pub assigned_agent: Option<Pubkey>`.
- `submit_result` asserts `ctx.accounts.task.assigned_agent == Some(agent)` when bid_book.is_some(). Tasks opened without `open_bidding` retain the M1 direct-assign path (gated by a `TaskContract.requires_bidding: bool` set by governance per category).

## Invariants

1. `commit_bid` outside `[commit_start, commit_end)` → `PhaseClosed`.
2. `reveal_bid` outside `[commit_end, reveal_end)` → `PhaseClosed`.
3. `commit_hash` mismatch on reveal → `RevealMismatch`, bond slashable, `bid.slashed = true`.
4. `close_bidding` before `reveal_end` → `PhaseOpen`.
5. `close_bidding` with `reveal_count == 0` → `phase = Cancelled`, task returns to Funded, client may re-open.
6. `claim_bond`:
   - `revealed == true && winner != self` → full refund.
   - `revealed == true && winner == self` → bond rolls into escrow alongside task payment (carry for dispute).
   - `revealed == false` → slash → fee_collector treasury.
7. `bond_amount = task.payment_amount * bond_bps / 10_000`, `bond_bps ∈ [MIN, MAX]`.
8. Cap: `commit_count <= MAX_BIDDERS_PER_TASK` — excess commits rejected. Prevents rent-grief (attacker opens 10k bid PDAs).
9. Stake-weighted tie-break reads `agent_registry::AgentAccount.stake_weight` via CPI (read-only, no mutation).

## Events

- `BidBookOpened { task_id, commit_end, reveal_end, bond_amount }`
- `BidCommitted { task_id, bidder, bond_paid }`
- `BidRevealed { task_id, bidder, amount }`
- `BidBookClosed { task_id, winner_agent, winner_amount, reveal_count }`
- `BidSlashed { task_id, bidder, bond_amount }`

## Integration with item 1 (typed task schema)

- `commit_bid` checks `payload.capability_bit ∈ agent.capability_bits` (CPI read-only to capability_registry + agent_registry). Kills griefing by agents that can't perform the task.

## Non-goals

- Dutch auction / English auction variants — out of scope; this is a single-price sealed-bid.
- Off-chain bid orderbook discovery — IACP surfaces open BidBooks via indexer.

## Verify

```
cargo test -p task_market bid_book_
anchor test tests/task_market_commit_reveal.ts
```

## Open questions (flag to orchestrator)

- Stake-weight source: currently `agent_registry::AgentAccount.stake_weight` is a proposed field; confirm with anchor-engineer that it lands before this ix.
- Permissionless `close_bidding` vs crank-only: permissionless is cheaper but any caller pays the rent-reclaim for Bid accounts. Propose crank incentive (1% of slashed bond) to avoid stuck BidBooks.
