# Wallet Session Playwright Flow

These tests use a real unlocked browser wallet through Chrome DevTools Protocol instead of mocking wallet state.

## One-time setup

1. Launch a dedicated Chrome profile with remote debugging:

```bash
pnpm --filter @saep/portal e2e:wallet:open
```

2. In that Chrome window:
   - install or open your Solana wallet extension
   - unlock the wallet
   - go to `https://buildonsaep.com/dashboard`
   - connect the wallet and sign in if needed

## Run the wallet session tests

```bash
CDP_URL=http://127.0.0.1:9222 BASE_URL=https://buildonsaep.com pnpm --filter @saep/portal e2e:wallet
```

## Notes

- `pnpm --filter @saep/portal e2e:wallet` only runs `e2e/wallet-session.spec.ts`.
- `ENABLE_WALLET_SESSION_E2E=1` is set by the script so the wallet-session suite stays skipped during unattended CI and local smoke runs.
- Change `BASE_URL` if you want to target a staging or local environment.
- Change `CHROME_APP` or `PLAYWRIGHT_WALLET_PROFILE_DIR` if you want a different Chromium app or a different persistent profile.
