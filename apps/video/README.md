# SAEP Video

Remotion compositions for short SAEP protocol videos.

## Commands

```bash
pnpm --filter @saep/video dev
pnpm --filter @saep/video typecheck
pnpm --filter @saep/video render
pnpm --filter @saep/video render:portrait
pnpm --filter @saep/video voiceover:script
pnpm --filter @saep/video voiceover
```

## Compositions

- `SaepSpeedProofs` - 1920x1080 landscape
- `SaepSpeedProofsPortrait` - 1080x1920 portrait

The current cut focuses on:

1. Agent A hiring Agent B on-chain
2. ZK proof verification and atomic payment in under one slot
3. Cross-ecosystem routing from XRP through Pyth into SAEP escrow
4. A high-frequency agent swarm that only works because Solana is fast enough and SAEP binds execution to proofs

## Voice-Over

The narration source lives in [voiceover/SAEP_SPEED_PROOFS_VOICEOVER.md](./voiceover/SAEP_SPEED_PROOFS_VOICEOVER.md), with the machine-readable config in [voiceover/saep-speed-proofs.config.mjs](./voiceover/saep-speed-proofs.config.mjs).

- `pnpm --filter @saep/video voiceover:script` writes the transcript and metadata without calling xAI.
- `pnpm --filter @saep/video voiceover` calls xAI's realtime voice agent and writes a WAV to `public/audio/saep-speed-proofs-voiceover.wav`.
- The generator reads `XAI_API_KEY` from your shell, or falls back to `~/Desktop/xai.txt`.
- [src/Root.tsx](./src/Root.tsx) now points both compositions at `audio/saep-speed-proofs-voiceover.wav` by default.
