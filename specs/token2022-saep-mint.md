# Spec — Token-2022 SAEP Mint (Public Contract)

**Owner:** anchor-engineer
**Depends on:** FeeCollector deployed, NXSStaking deployed, GovernanceProgram deployed, public authority inventory published
**Blocks:** M3 SAEP payment path, FeeCollector confidential fee harvest activation, NXSStaking InterestBearing activation
**References:** backend PDF §1.3, backend PDF §2.6, backend PDF §4.3, backend PDF §5.1, pre-audit-05

> This document describes the public configuration and verification contract for the canonical SAEP mint. Maintainer-only release choreography, signer logistics, and custody procedures are intentionally excluded from the public repo.

## Goal

Define the canonical SAEP Token-2022 mint, its extension set, its post-handover authority layout, and the public evidence required to verify that activation was performed correctly.

## Mint configuration

| Field | Value |
|---|---|
| Name | `SAEP` |
| Symbol | `SAEP` |
| Decimals | `9` |
| Initial supply | `0` |
| Metadata storage | `MetadataPointer` self-reference |

Metadata updates are governance-controlled after handover. The initial metadata URI is fixed by the release configuration used for activation.

## Extensions

The canonical mint includes these Token-2022 extensions:

### ConfidentialTransfer

- Tier: opt-in (`auto_approve_new_accounts = true`)
- Auditor ElGamal key: governance multisig (rotatable via governance proposal)
- Purpose: encrypted balances and transfer amounts for agent privacy
- Post-handover authority: governance-controlled authority surface

### ConfidentialTransferFee

- Authority: FeeCollector PDA
- Purpose: fee withholding on confidential transfers via ZK proofs
- Post-handover authority: FeeCollector PDA (same as TransferFee withdraw authority)

### TransferFee

- Default fee: `10` basis points
- Maximum fee: `1_000_000 * 10^9`
- Post-handover config authority: governance-controlled authority surface
- Withdraw authority: FeeCollector PDA

### InterestBearing

- Initial rate: `0`
- Post-handover rate authority: NXSStaking PDA
- Purpose: governance-controlled APY updates through NXSStaking

### MetadataPointer

- Metadata address: mint self-reference
- Post-handover authority: governance-controlled authority surface

### Pausable

- Default state: unpaused
- Post-handover authority: emergency authority surface

## Excluded extensions

### TransferHook

Excluded because it cannot coexist with ConfidentialTransfer. Advisory-only hook logic (mint identity validation, pause checks, amount guards) migrated to instruction-level guards at each program call site.

### PermanentDelegate

Excluded because it cannot operate on encrypted balances. Burn path uses vault-PDA-owner authority (unchanged from prior design — `execute_burn` already signs via `burn_vault` PDA, not PermanentDelegate).

### CpiGuard

Excluded because SAEP depends on legitimate multi-program CPI paths.

### MemoTransfer

Excluded because memo enforcement is not a mint-level requirement.

### NonTransferable

Excluded because SAEP is a transferable fungible token.

## Activation invariants

The mint activation is valid only if all of the following are true:

1. The extension set is finalized before `initialize_mint`.
2. Metadata is initialized through the self-referential metadata pointer.
3. `MintTokens` authority is set to `None` after handover.
4. `FreezeAccount` authority is set to `None` after handover.
5. Every remaining mutable authority points to the intended governance, emergency, or program-derived authority.
6. No unconstrained EOA remains as a long-term authority after handover.
7. ConfidentialTransfer auditor key is set to the governance-held ElGamal public key.

## Post-handover authority targets

| Surface | Target |
|---|---|
| MintTokens | `None` |
| FreezeAccount | `None` |
| TransferFeeConfig | Governance authority |
| WithheldWithdraw | FeeCollector PDA |
| ConfidentialTransferMint | Governance authority |
| ConfidentialTransferFeeAuthority | FeeCollector PDA |
| InterestBearingRateAuthority | NXSStaking PDA |
| MetadataPointerAuthority | Governance authority |
| MetadataUpdateAuthority | Governance authority |
| PausableAuthority | Emergency authority |

## Confidential transfer operational model

- **Tier:** Opt-in. Token accounts must call `configure_account` to enable confidential transfers.
- **Dual-mode:** Transfers between plaintext accounts use standard `transfer_checked`. Transfers to configured accounts use `confidential_transfer_checked`.
- **Feature gate:** FeeCollectorConfig.`confidential_transfers_enabled` (governance-toggled). When false, all transfers route through plaintext `transfer_checked` regardless of account configuration. Flipped to true when ZK ElGamal Proof program re-enables on mainnet.
- **Auditor keys:** Governance-held ElGamal key enables selective disclosure for compliance. Rotatable via governance proposal without affecting existing encrypted balances.
- **Internal vaults:** Program-owned accounts (escrow, burn_vault, intake_vault, staker_vault) remain in plaintext mode — no privacy requirement for protocol-owned state.

## Public verification outputs

Any activation record for the canonical mint must expose:

- The mint address.
- The configuration hash used for activation.
- The initialization transaction signature.
- The metadata initialization transaction signature, if separate.
- The handover transaction signature.
- A post-handover authority dump proving the targets above.
- The auditor ElGamal public key.

The public record may live in release notes, docs, or another public artifact set, but it must be reproducible from public data.

## `scripts/init-saep-mint.ts`

The public script in this repo is a rehearsal and verification tool:

- `--dry-run`: validates instruction ordering and account sizing without broadcasting.
- `--devnet`: performs a rehearsal activation and writes a local state file.
- `--mainnet`: intentionally refuses execution from the public repo path.

Mainnet activation must be verifiable from public outputs, but the public repo does not carry maintainer-only execution procedures.

## CPI contract

- FeeCollector harvests TransferFee withheld tokens and ConfidentialTransferFee withheld tokens.
- FeeCollector controls the confidential transfer fee authority for encrypted fee withdrawal.
- NXSStaking updates the InterestBearing rate through its PDA.
- Governance updates mutable non-emergency authorities.
- Governance rotates the ConfidentialTransfer auditor ElGamal key.
- Emergency authority controls pause and unpause.

## Security checks

- ConfidentialTransfer auditor key is set and governance-controlled.
- ConfidentialTransferFee authority matches FeeCollector PDA.
- TransferFee maximum fee stays bounded.
- InterestBearing rate changes are routed through NXSStaking.
- MetadataPointer remains self-referential unless governance intentionally changes it.
- Mint inflation is impossible after handover because mint authority is `None`.
- Freeze authority is not retained as a selective backdoor once handover completes.

## Repository boundary

This repository may contain:

- Public configuration values.
- Public authority mappings.
- Public verification artifacts and hashes.
- Public rehearsal tooling.

This repository must not contain:

- Maintainer-only ceremony notes.
- Signer logistics.
- Custody procedures.
- Private release checklists.
- Private storage locations for release artifacts.

## Done checklist

- [ ] Canonical mint address published
- [ ] Extension set published
- [ ] Post-handover authority inventory published
- [ ] Config hash published
- [ ] Init and handover transaction signatures published
- [ ] Public verification confirms `MintTokens == None`
- [ ] Public verification confirms `FreezeAccount == None`
- [ ] Public verification confirms every remaining authority matches the intended target
- [ ] ConfidentialTransfer auditor ElGamal public key published
- [ ] ConfidentialTransferFee authority matches FeeCollector PDA
