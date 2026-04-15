---
id: P1_sdk_typescript_generation
status: open
blockers: []
priority: P1
---

# SDK — automated TypeScript generation from IDLs

## Why
`packages/sdk/src/generated/` and `idl/` exist but regeneration is manual. The loop regenerates IDLs every time a program changes; the SDK must follow automatically so consumers (`saep-app`, future agents) always see fresh types.

## Acceptance
- `pnpm --filter @saep/sdk generate` reads every IDL from `../../target/idl/*.json` and emits:
  - Per-program account + instruction + event types under `src/generated/<program>.ts`.
  - PDA helpers in `src/pda/<program>.ts` for every `seeds:[...]` pattern found in IDL.
  - A central `src/generated/index.ts` barrel.
- `pnpm --filter @saep/sdk build` passes with no `any` leakage outside `generated/`.
- CI hook (`turbo.json` pipeline) runs generate before build.

## Steps
1. Audit current `src/generated/` — keep if usable, replace if stale.
2. Pick generator: `anchor-client-gen` (battle-tested) vs hand-rolled on `@coral-xyz/anchor` IDL types. Default to `anchor-client-gen` unless it conflicts with existing patterns.
3. Add `scripts/gen.ts` in SDK; wire `"generate": "tsx scripts/gen.ts"`.
4. Update `turbo.json`: `build` dependsOn `generate` in sdk pipeline.
5. Regenerate; fix any downstream type breaks in `apps/`.

## Verify
```
cd /Users/dennisgoslar/Projects/SAEP
pnpm --filter @saep/sdk generate
pnpm --filter @saep/sdk build
pnpm -w typecheck
```

## Log
