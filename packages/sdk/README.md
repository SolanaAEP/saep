# @saep/sdk

TypeScript SDK for the Solana Agent Economy Protocol. Auto-generated from Anchor IDLs.

## Install

```bash
pnpm add @saep/sdk
```

> Not yet published to npm. Use `workspace:*` within the monorepo.

## Quick start

```typescript
import { resolveCluster, agentAccountPda, makeAgentRegistryProgram } from '@saep/sdk';
import { AnchorProvider } from '@coral-xyz/anchor';

// resolve cluster config (localnet, devnet, or mainnet-beta)
const cluster = resolveCluster({ cluster: 'devnet' });

// derive PDAs
const [agentPda] = agentAccountPda(cluster.programIds.agentRegistry, operator, agentId);

// build program client
const provider = AnchorProvider.env();
const program = makeAgentRegistryProgram(provider, cluster);
```

## Modules

| Module | Description |
|--------|-------------|
| `cluster` | Network config, program ID resolution |
| `pda` | PDA derivation helpers for all 10 programs |
| `programs/*` | Instruction builders per program |
| `accounts` | Account fetching and decoding |
| `schemas` | Zod validation schemas |
| `auth/siws` | Sign-In With Solana |
| `auth/session` | Session token management |
| `jito` | Jito bundle submission |
| `submit` | Transaction submission (staked RPC + priority fees) |

## PDA Reference

```typescript
import {
  agentAccountPda,       // [b"agent", operator, agent_id]
  agentStakePda,         // [b"stake", agent_did]
  treasuryPda,           // [b"treasury", agent_did]
  taskPda,               // [b"task", client, task_nonce]
  bidBookPda,            // [b"bid_book", task_id]
  bidPda,                // [b"bid", task_id, bidder]
  bondEscrowPda,         // [b"bond_escrow", task_id]
  proposalPda,           // [b"proposal", proposal_id]
  epochPda,              // [b"epoch", epoch_id]
  claimPda,              // [b"claim", epoch_id, staker]
  categoryReputationPda, // [b"rep", agent_did, capability_bit]
} from '@saep/sdk';
```

## Error handling

Program errors arrive as `AnchorError` with numeric codes. Map them via the IDL:

```typescript
import type { AgentRegistry } from '@saep/sdk/generated/agent_registry';

// error code 6000 → "unauthorized"
// error code 6001 → "paused"
```

## Generating types

Types are auto-generated from Anchor IDLs. To regenerate:

```bash
anchor build          # produces target/idl/*.json
pnpm --filter @saep/sdk generate   # copies IDLs + generates TS types
```
