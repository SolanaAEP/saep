# Spec — Token-2022 SAEP Mint (Public Contract)

**Status:** post-launch — describes the live mint, not an aspirational target.
**Mint:** `HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump`
**Cluster:** Solana mainnet-beta
**Companion:** [`tokenomics-activation.md`](./tokenomics-activation.md) covers the protocol-side economy that wraps this mint.

> A prior version of this document specified an aspirational mint configuration (TransferHook, TransferFee, PermanentDelegate, InterestBearing, Pausable) intended for a future canonical activation. That activation never happened: SAEP launched via pump.fun's bonding-curve contract, which produces a renounced Token-2022 mint with a minimal extension set. The aspirational version is preserved in this file's git history; this revision documents the live mint and the verification contract that applies to it.

## Why this differs from the original spec

`SAEP` was created by pump.fun's `pump-fun` program at the time of public launch. Pump.fun mints are Token-2022 and renounce all mutable authorities (mint, freeze, metadata-update) once the bonding curve graduates, leaving a fixed-supply community-owned token. **Most Token-2022 extensions are immutable post-init**, so the aspirational extension set cannot be retrofitted onto this mint. The protocol economy was always going to be CPI-driven — `fee_collector::record_intake` accepts fees from registered programs, and `task_market::release` already carves the protocol fee out of payouts before they reach agents — so the absence of mint-level extensions is a posture choice, not a missing feature.

The reduction in mint surface is itself a security feature. Fewer extensions mean fewer ways to brick the mint, fewer paths for governance compromise to drain holders, and fewer audit-equivalent claims to validate.

## Live mint configuration

| Field | Value |
|---|---|
| Mint address | `HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump` |
| Token program | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` (Token-2022) |
| Name | `SAEP` |
| Symbol | `SAEP` |
| Decimals | `6` |
| Supply (post-launch fixed) | `999,990,151.438427` SAEP (≈1B) |
| Mint authority | `None` (revoked) |
| Freeze authority | `None` (revoked) |

## Extensions present on the mint

The live mint has exactly two Token-2022 extensions. Anything not listed here is absent and cannot be added without re-minting.

### MetadataPointer

- Metadata address: self-referential (the mint stores its own metadata in-account)
- Authority: `None` (immutable)

### TokenMetadata

- Name: `SAEP`
- Symbol: `SAEP`
- URI: `https://ipfs.io/ipfs/bafkreihfjbhflg3fmm7nu6etnlvr7ctwyagboa2ll6h54ehb6b5xt77xwq`
- Update authority: `None` (immutable)
- Additional metadata: empty

## Extensions absent from the mint (intentional)

The following extensions are **not** present and cannot be retrofitted. Each has an explicit substitute in `tokenomics-activation.md`:

| Absent extension | What it would have done | Substitute |
|---|---|---|
| `TransferHook` → FeeCollector | Transfer-time policy checks + fee enforcement on every transfer | Fee collection at task-settlement time only — protocol fee + solrep fee carved out in `task_market::release` before payout. Secondary-market transfers do not contribute fee revenue. |
| `TransferFeeConfig` (10 bps) | Automatic 10 bps cut on every transfer to a withholding account | Settlement-time fees only; no automatic secondary-market fee surface |
| `PermanentDelegate` | Protocol-controlled claw-back of any holder's balance | Lost or stolen SAEP cannot be recovered by the protocol. Standard renounced-mint posture. |
| `InterestBearingConfig` | Native rebase APY visible to all holders | Distribution model — fee revenue accumulates in a vault, `fee_collector::commit_distribution` allocates per-staker shares, `nxs_staking::claim_staker` drains them. APY is computed from realised distribution per epoch, not native rebase. |
| `Pausable` | Emergency mint freeze halting all transfers | The mint cannot be paused. Program-level pause hooks exist on dependent programs (`fee_collector::set_paused`, `task_market::pause`, etc.) and halt the protocol-side flow, but secondary trading on the mint continues during any incident. Documented explicitly so holders are not surprised. |
| `MintCloseAuthority` | Reclaim rent if mint is later destroyed | Not relevant — mint is fixed and decentralised |
| `ConfidentialTransferMint` | Privacy-preserving transfers | Out of scope; would require re-mint |

## Renounced authorities — verification

All mutable authorities on the mint are `None`. This means:

1. No new SAEP can be minted. Supply is fixed at the value in the configuration table above.
2. No account holding SAEP can be frozen by any authority — neither protocol nor pump.fun.
3. The metadata URI cannot be changed.
4. The token program itself (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) is immutable.

## RPC verification

Anyone can confirm the live state of the mint:

```bash
curl -s -X POST https://solana-rpc.publicnode.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump",{"encoding":"jsonParsed","commitment":"confirmed"}]}' \
  | jq .result.value.data.parsed.info
```

The output should match the configuration table above: `decimals: 6`, `mintAuthority: null`, `freezeAuthority: null`, two extensions only.

## CPI contract

The mint does not require any program-side CPI to function as a Token-2022 token. Standard SPL Token-2022 ix (`transfer_checked`, `burn_checked`, etc.) work as expected. The protocol-side economy (`fee_collector`, `nxs_staking`, `governance_program`, `treasury_standard`, `task_market`) interacts with SAEP through normal token instructions — there are no mint-extension hooks to satisfy.

`fee_collector::execute_burn` calls Token-2022 `burn_checked` against a SAEP balance held by the FeeCollector PDA. This works without any special mint extension because anyone may burn tokens they hold.

## Security checks (for the post-launch posture)

- Mint authority is permanently `None`. Inflation is impossible.
- Freeze authority is permanently `None`. No selective backdoor.
- Metadata is immutable. The URI cannot be replaced with a phishing destination.
- No transfer-time policy hooks. Holders can transfer to any destination without protocol intermediation.
- No claw-back. Wallet-loss / phishing / private-key compromise are unrecoverable for the holder.
- No emergency pause. In a vulnerability scenario the protocol pauses program-side, but secondary trading continues — caps + bounty pool are the blast-radius bounds (see `SECURITY-REVIEW.md`).

## Public verification artifacts

Reproducible from public data — no maintainer-only inputs required:

- Mint address (above)
- Pump.fun launch transaction signature (locatable via Solana explorer or a Pump.fun history query)
- Fixed supply value at launch — readable from any RPC
- Two extension state accounts — readable from any RPC

## `scripts/init-saep-mint.ts`

Retained for reference and devnet rehearsal of a *hypothetical* canonical mint with the original extension set. The script is not used to manage the live mint and never will be — the live mint is renounced and external to anything in this repository. Local devnet rehearsal remains useful for prototyping any future re-mint scenario.

- `--dry-run`: validates the original aspirational config offline.
- `--devnet`: rehearses an activation against devnet.
- `--mainnet`: intentionally refuses execution.

## Repository boundary

This file documents publicly verifiable facts about the live mint. Maintainer-only operational notes, custody procedures, and signer logistics are intentionally excluded.

## Done checklist

- [x] Canonical mint address published
- [x] Extension set published (live values)
- [x] Renounced authorities documented
- [x] RPC verification snippet provided
- [x] Substitute architecture cross-referenced (`tokenomics-activation.md`)
- [x] Public verification confirms `mintAuthority == None`
- [x] Public verification confirms `freezeAuthority == None`
- [x] Public verification confirms metadata is immutable
