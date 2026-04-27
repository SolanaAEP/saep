# @saep/buyback-bot

Off-chain worker that drives the SAEP buyback-and-burn cadence. Polls the protocol fee accumulator, quotes USDC → SAEP via Jupiter v6, and (in active mode, future) executes the swap and deposits SAEP into the `fee_collector` intake vault so the on-chain `process_epoch` and `execute_burn` cycle can run.

## Status

**Observe-only.** The current build reads the fee accumulator balance, requests a Jupiter quote, and emits metrics. It does **not** sign or submit transactions. Active mode is gated on the operator keypair being provisioned and on `fee_collector` being initialised on mainnet (Mainnet activation completion sprint, phase 2).

## Architecture

1. Resolve `MarketGlobal` (PDA derived from the task_market program id) and read its `fee_collector` field.
2. Look up the USDC token account owned by `MarketGlobal.fee_collector`.
3. Read the USDC balance.
4. If the balance is at or above `BUYBACK_SWAP_THRESHOLD_USDC_BASE`, request a Jupiter v6 quote for an exact-in swap to SAEP.
5. Validate the quote's price impact against `BUYBACK_SLIPPAGE_BPS`.
6. (Active mode, future) Sign and submit the Jupiter swap, deposit the resulting SAEP into the fee_collector intake vault.
7. (Active mode, future) Call `fee_collector::process_epoch` and `fee_collector::execute_burn` if the epoch state warrants it.

## Configuration

| Env | Default | Notes |
|---|---|---|
| `BUYBACK_PORT` | `10000` | Health and metrics endpoint |
| `SOLANA_RPC_URL` | `https://api.mainnet-beta.solana.com` | Solana JSON-RPC |
| `SAEP_CLUSTER` | `mainnet-beta` | Display label |
| `BUYBACK_MODE` | `observe` | `observe` or `active` |
| `SAEP_MINT` | `HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump` | |
| `USDC_MINT` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | |
| `TASK_MARKET_PROGRAM_ID` | `HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w` | |
| `FEE_COLLECTOR_PROGRAM_ID` | `4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu` | |
| `BUYBACK_POLL_INTERVAL_MS` | `3600000` | One hour minimum cadence |
| `BUYBACK_SWAP_THRESHOLD_USDC_BASE` | `50000000` | 50 USDC at 6 decimals |
| `BUYBACK_SLIPPAGE_BPS` | `200` | Hard cap; quotes above this are skipped |
| `JUPITER_API_URL` | `https://quote-api.jup.ag/v6` | |
| `OPERATOR_KEYPAIR_PATH` | _unset_ | Required for active mode (future) |
| `LOG_LEVEL` | `info` | pino |

## Endpoints

- `GET /healthz` — liveness with current mode and cluster.
- `GET /metrics` — Prometheus metrics: `saep_buyback_fee_accumulator_usdc_base`, `saep_buyback_quote_saep_out_base`, `saep_buyback_quote_price_impact_bps`, plus tick counters and durations.

## Operational notes

- Active-mode authority surface: the operator keypair will be a SOL-only wallet with no SAEP or USDC custody beyond in-flight swap state. It must not hold withdrawal authority over any protocol account; its only on-chain capability is to sign Jupiter swaps from its own ATA and call `fee_collector::execute_burn` (which uses the burn vault PDA as the burn authority via signer seeds, so the operator just pays gas).
- The bot remains observe-only until both `OPERATOR_KEYPAIR_PATH` is set and `fee_collector` is initialised on mainnet. Either condition missing keeps the worker in read-only mode.
- Slippage cap is a hard skip rather than a slow-walk. A quote that exceeds `BUYBACK_SLIPPAGE_BPS` is logged and discarded; the next tick re-quotes.
- Buyback cadence (default 1 hour) is intentionally slow to limit MEV exposure on each individual swap. A future Jito bundle path may shorten the cadence.
