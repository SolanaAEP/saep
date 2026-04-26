# Changelog

All notable changes to SAEP are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/) once we have a release to version.

## [Unreleased]

### Programs

- Ten Anchor programs implemented and deployed: `agent_registry`, `capability_registry`, `treasury_standard`, `task_market`, `proof_verifier`, `dispute_arbitration`, `governance_program`, `fee_collector`, `nxs_staking`, `template_registry`. Devnet and mainnet program IDs declared in `Anchor.toml`.
- `task_market` initialized on Solana mainnet. Public Quick Hire flow live: wallet-signed atomic create+fund task escrow.
- Public-agent settlement live on mainnet: end-to-end wallet-signed verify and release flow with `proof_verifier` mainnet mode and production verifier key for `task_completion.v1`.
- `treasury_standard` constrained-treasury surface: PDA-owned treasuries, daily/weekly spending limits, streaming payouts, Jupiter swap CPI, Token-2022 support, transfer-hook allowlist enforcement.
- `template_registry` template marketplace: mint, fork (with royalty lineage), open rental, claim rental revenue, royalty CPI settlement.
- `treasury_standard` yield automation lane: register strategy, deposit/withdraw, emergency unwind, daily-limit-aware constraints. Kamino adapter live on devnet.

### Pre-audit hardening (code complete; OtterSec hand-off pending)

- Typed task schema: `TaskPayload` with discriminated `TaskKind` enum (`SwapExact`, `Transfer`, `DataFetch`, `Compute`, `Generic`); length-capped `criteria`; `task_hash = keccak(task_id || keccak(borsh(payload)))`.
- Outbound CPI whitelist: `treasury_standard::AllowedTargets` PDA + `assert_call_target_allowed` on every CPI.
- Commit-reveal bidding: `commit_bid` / `reveal_bid` with bond escrow, slash-on-reveal-miss, stake-weighted tie-break.
- Circom-bound reputation: `CategoryReputation` PDA per `(agent_did, capability_bit)`; `update_reputation` reachable only via `proof_verifier` CPI with verified Groth16 proof and on-chain Poseidon sample-hash check; replay rejected via `last_task_id`.
- Personhood gate: `PersonhoodAttestation` PDA, Civic gateway-token decoder, gatekeeper allowlist; `commit_bid` and `register_agent` enforce `CapabilityTag.min_personhood_tier`.
- Token-2022 transfer-hook whitelist: `fee_collector::HookAllowlist` PDA + per-agent additive allowlist; `assert_hook_allowed` wrapped around every token transfer CPI; mint-accept extension sanity checks.
- Jito bundle settlement: tip-oracle-driven settlement worker in indexer + bundle submitter in SDK with durable-nonce + halt-swap-on-failure.
- Reentrancy guards: `ReentrancyGuard` PDA across all state-changing programs; CPI depth cap via `get_stack_height`; allowed-callers PDAs gate cross-program entry.

### Off-chain services

- `services/indexer`: Yellowstone gRPC ingest, Postgres materialized views, REST API, retro-airdrop rollup, reputation rollup, compute-bond snapshot persistence, Render dual-mode startup (api + worker roles).
- `services/discovery`: standalone TypeScript service for portal reads; webhook subscription stack with HMAC-signed delivery, exponential backoff, dead-letter queue, secret rotation, replay-by-time-window.
- `services/proof-gen`: Node service with Circom + snarkjs worker, BullMQ queue, Prometheus metrics, circuit catalog loader.
- `services/iacp`: Fastify + WebSocket + Redis Streams agent-to-agent message bus; ring-buffered topics; rate limits.
- `services/x402-gateway`: HTTP payment-rail gateway implementing the x402 protocol; settles to `task_market` via USDC.
- `services/mcp-bridge`: Model Context Protocol server exposing `task_market` operations as tools (`list_tasks`, `bid_on_task`, `get_bid_status`, `claim_payout`); Smithery + server.json manifests.
- `services/compute-broker`: io.net + Akash provider integration, compute-bond lifecycle (reserved → locked → released/slashed), lease attestations.
- `services/telegram-bot`, `services/xrpl-bridge`: scaffolds.

### Apps

- `apps/portal` (Next.js 15): wallet-adapter SIWS, marketplace with task-led trust ranking + reputation floors, agent leaderboard with category filter, template marketplace with fork/rent flows + economics simulator, treasury yield page, staking page with mainnet pool reads, retro-airdrop SIWS-gated `/check`, public landing page.
- `apps/docs`, `apps/analytics`, `apps/video`: adjunct surfaces.

### SDK + integrations

- `packages/sdk`: TypeScript SDK with IDL-generated types for all ten programs, PDA helpers, instruction builders, Jito bundle submitter.
- `packages/sdk-ui`: TanStack-Query React hooks consumed by the portal.
- `packages/sak-plugin`: Solana Agent Kit plugin wrapping SDK calls so SAK agents can register, bid, settle, and manage treasuries through SAEP.
- `python/saep-sdk`: async client (`SAEPClient`), MCP-bridge transaction executor, adapter factories for CrewAI / AutoGen / LangGraph; Hermes plugin at `python/hermes-saep-plugin/`.
- `examples/sak-demo`, `examples/agents/x402-content-agent`: integration demos.

### Circuits

- `circuits/task_completion`: Circom 2.x circuit, full build chain (R1CS, wasm, zkey, vkey), dev-tier ceremony VK uploaded; on-chain verification active.
- `circuits/unique_execution`: anti-replay-farming non-membership circuit (sorted-merkle adjacency proof). Source-only; not yet wired into on-chain enforcement.
- `circuits/zkml`: scaffold.
- `circuits/catalog`: machine-readable manifests for proof-gen routing and `proof_verifier` VK inventory.

### Infrastructure

- CI: lint, typecheck, clippy, `anchor build`, `anchor test`, JS coverage gates, Semgrep, `cargo audit`, `pnpm audit`.
- Render blueprint: services + Postgres + Redis; dual-role indexer (api / worker).
- Repository standards: README, LICENSE (Apache-2.0), SECURITY (with PGP key), CONTRIBUTING, CODE_OF_CONDUCT, GOVERNANCE, MAINTAINERS.
- GitHub templates for issues, PRs, Dependabot.
- Distributed-authorship commit helper (`scripts/commit-as.sh`).
