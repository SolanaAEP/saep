# integration-sak — Solana Agent Kit plugin

Parent: `backlog/P1_protocol_integrations_x402_mcp_sak.md` §SAK.
Target: SendAI's Solana Agent Kit (`github.com/sendaifun/solana-agent-kit`). Ship a plugin so any SAK-wrapped agent can register, bid, settle, and manage treasury via SAEP.

## Approach

Two options considered:

1. **Fork SAK** — hard, creates divergence, ongoing rebase burden. Reject.
2. **Contribute upstream plugin** — SAK has a plugin/action registry. Write `@solana-agent-kit/saep` as an external npm package that registers SAEP actions into any SAK agent instance.

Pick option 2. Ship package under SAEP monorepo at `packages/sak-plugin/`, publish separately post-M1.

## Package surface

```ts
// packages/sak-plugin/src/index.ts
import type { SolanaAgentKit, Action } from '@solana-agent-kit/core';
import { registerAgent, createTask, commitBid, revealBid, submitResult, claimPayout }
  from '@saep/sdk/programs';

export function saepPlugin(cluster: 'devnet' | 'mainnet-beta' = 'devnet'): Action[] {
  return [
    saepRegisterAgentAction(cluster),
    saepCreateTaskAction(cluster),
    saepBidAction(cluster),
    saepSubmitResultAction(cluster),
    saepClaimPayoutAction(cluster),
    saepListTasksAction(cluster),
    saepRentTemplateAction(cluster),
    saepGetReputationAction(cluster),
  ];
}
```

Each action:
- `name`: stable id (e.g. `SAEP_CREATE_TASK`).
- `similes`: natural-language triggers for LLM routing.
- `description`: one-line summary + arg schema.
- `examples`: 2-3 prompt→action examples SAK uses for few-shot routing.
- `schema`: zod schema for args.
- `handler(agent: SolanaAgentKit, input: z.infer<typeof schema>)`: constructs + signs + submits tx via `agent.wallet`.

## Agent key story

SAK agents carry their own `SolanaAgentKit` wallet. SAEP plugin never introduces a second wallet; operator key = SAK wallet. One-time bootstrap action `SAEP_BOOTSTRAP` registers the SAK wallet as operator + creates the first `AgentAccount` if absent.

## Example

`examples/sak-demo/index.ts`:

```ts
import { SolanaAgentKit } from '@solana-agent-kit/core';
import { saepPlugin } from '@saep/sak-plugin';

const agent = new SolanaAgentKit(
  process.env.SOLANA_PRIVATE_KEY!,
  'https://api.devnet.solana.com',
  { OPENAI_API_KEY: process.env.OPENAI_API_KEY },
);
agent.registerActions(saepPlugin('devnet'));

// Natural-language: SAK routes to SAEP_BID on matching tasks.
await agent.chat('Find all image-generation tasks under 0.1 SOL and bid on the best one.');
```

## Minimum actions for M1

Cut down from 8 to the 4 highest-leverage:
- `SAEP_REGISTER_AGENT`
- `SAEP_LIST_TASKS`
- `SAEP_BID` (commit+reveal handled internally)
- `SAEP_SUBMIT_RESULT`

Remaining 4 ship with the full plugin release in M2.

## Tests

- unit: each action's handler mocked against an AnchorProvider fixture.
- integration: devnet-demo script under `examples/sak-demo/` end-to-end: register → fund task → bid → submit → claim. Expect ~$0.05 in test SOL per run.

## Upstream contribution path

- Publish `@saep/sak-plugin` to npm.
- Open PR on `sendaifun/solana-agent-kit` adding reference to the plugin in its ecosystem README.
- If SAK has a plugin marketplace (TBD 2026-04), list there.

## Non-goals

- Auto-topup agent balance from SAK treasury — out of scope; users explicitly fund.
- Cross-kit support (ElizaOS, ai16z) — separate plugins; same pattern, different import surface. Track as follow-up.
