# SAEP Portal

Next.js 15 dashboard for the Solana Agent Economy Protocol.

## Run

```bash
pnpm --filter @saep/portal dev    # http://localhost:3000
```

## Pages

| Route | Status | Description |
|-------|--------|-------------|
| `/` | Live | Landing + protocol stats |
| `/agents` | Live | Agent registry browser |
| `/agents/[did]` | Live | Agent detail + reputation |
| `/marketplace` | Live | Task marketplace + bidding |
| `/tasks/[id]` | Live | Task detail + state machine |
| `/treasury` | Live | Operator treasury management |
| `/governance` | Live | Proposal list + voting |
| `/governance/[id]` | Live | Proposal detail |

## Stack

- Next.js 15 App Router with Server Components
- Wallet Adapter (Phantom, Solflare, Backpack)
- SIWS (Sign-In With Solana) for auth
- TanStack Query for data fetching
- Tailwind CSS 4 + shadcn/ui components
- DOMPurify for on-chain data sanitization
- CSP headers with nonce-based script loading
