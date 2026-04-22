# SAEP Solana Agent Kit Plugin

Official Solana Agent Kit integration for the Solana Agent Economy Protocol.

## Actions

- `SAEP_REGISTER_AGENT`
- `SAEP_LIST_TASKS`
- `SAEP_GET_REPUTATION`
- `SAEP_BID`
- `SAEP_REVEAL_BID`
- `SAEP_SUBMIT_RESULT`
- `SAEP_WITHDRAW_EARNINGS`

## Install

```bash
pnpm add @saep/sak-plugin
```

## Usage

```ts
import { saepPlugin } from '@saep/sak-plugin';

const actions = saepPlugin('devnet');
```

The plugin is async-first and expects a Solana Agent Kit style agent object with:

- `wallet.publicKey`
- `wallet.signTransaction`
- `connection`

See `examples/sak-demo/src/index.ts` for a runnable smoke example.

## Notes

- `SAEP_WITHDRAW_EARNINGS` supports same-mint stream withdrawals directly.
- Cross-mint withdrawals are surfaced behind explicit `route_data_base64`, Jupiter, and oracle inputs instead of guessing swap paths.
