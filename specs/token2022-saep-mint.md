# Spec — Token-2022 SAEP Mint (Public Contract)

**Owner:** anchor-engineer
**Depends on:** FeeCollector deployed, NXSStaking deployed, GovernanceProgram deployed, public authority inventory published
**Blocks:** M3 SAEP payment path, FeeCollector TransferHook activation, NXSStaking InterestBearing activation
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

### TransferHook

- Program: `FeeCollector`
- Purpose: protocol fee enforcement and hook-aware policy surface
- Post-handover authority: governance-controlled authority surface

### TransferFee

- Default fee: `10` basis points
- Maximum fee: `1_000_000 * 10^9`
- Post-handover config authority: governance-controlled authority surface
- Withdraw authority: FeeCollector PDA

### PermanentDelegate

- Delegate: FeeCollector PDA
- Purpose: constrained fee and dust recovery path
- Post-handover authority: governance-controlled authority surface

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

### ConfidentialTransfer

Excluded because it cannot coexist with TransferHook on the canonical SAEP mint.

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

## Post-handover authority targets

| Surface | Target |
|---|---|
| MintTokens | `None` |
| FreezeAccount | `None` |
| TransferFeeConfig | Governance authority |
| WithheldWithdraw | FeeCollector PDA |
| TransferHookProgramId | Governance-controlled authority |
| PermanentDelegate authority | Governance authority |
| InterestBearingRateAuthority | NXSStaking PDA |
| MetadataPointerAuthority | Governance authority |
| MetadataUpdateAuthority | Governance authority |
| PausableAuthority | Emergency authority |

## Public verification outputs

Any activation record for the canonical mint must expose:

- The mint address.
- The configuration hash used for activation.
- The initialization transaction signature.
- The metadata initialization transaction signature, if separate.
- The handover transaction signature.
- A post-handover authority dump proving the targets above.

The public record may live in release notes, docs, or another public artifact set, but it must be reproducible from public data.

## `scripts/init-saep-mint.ts`

The public script in this repo is a rehearsal and verification tool:

- `--dry-run`: validates instruction ordering and account sizing without broadcasting.
- `--devnet`: performs a rehearsal activation and writes a local state file.
- `--mainnet`: intentionally refuses execution from the public repo path.

Mainnet activation must be verifiable from public outputs, but the public repo does not carry maintainer-only execution procedures.

## CPI contract

- FeeCollector consumes TransferHook callbacks and TransferFee withdrawal authority.
- FeeCollector uses the PermanentDelegate path subject to its own program checks.
- NXSStaking updates the InterestBearing rate through its PDA.
- Governance updates mutable non-emergency authorities.
- Emergency authority controls pause and unpause.

## Security checks

- TransferHook points at the expected FeeCollector program.
- TransferFee maximum fee stays bounded.
- PermanentDelegate scope is constrained by FeeCollector program logic.
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
