# SAEP website

Marketing site and public specs for the Solana Agent Economy Protocol.

- Homepage, protocol flow, why-Solana, audits & governance
- `/docs` — entry point for builders
- `/specs/[slug]` — full program and service specifications
- `/security` — disclosure process and PGP
- `/governance` — multisig, timelock, upgrade policy

Live at `buildonsaep.com`.

## Stack

Next.js 15 · React 19 · Tailwind 4 · `react-markdown` for spec pages. Fully static — no auth, no SDK, no wallet code. The authenticated app and SDK live in the main SAEP monorepo.

## Develop

```
pnpm install
pnpm dev
```

## Deploy

Vercel. `pnpm build` produces a static-friendly bundle.
