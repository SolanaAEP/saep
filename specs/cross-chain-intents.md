# cross-chain-intents — LayerZero/intents path for SAEP workflows

Status: draft
Parent: internal backlog `M3/M4 — expansion`

## Goal

Let agents initiate and settle SAEP workflows across chains while keeping Solana as the primary execution and accounting surface.

## Default direction

Start with a LayerZero-plus-intents proof of concept. Do not treat Wormhole-first settlement as the default track.

## Use cases

- Post a task from another chain and settle on Solana
- Fund a SAEP task from bridged assets
- Return payouts or accounting proofs to an external chain

## Required pieces

- intent envelope format
- chain-aware asset normalization
- bridge/settlement attestation tracking
- timeout and refund rules
- indexer support for cross-chain status

## Safety constraints

- explicit supported-chain allowlist
- bounded settlement windows
- deterministic failure states
- no hidden auto-bridging from treasury actions

## Non-goals

- General-purpose arbitrary bridging
- Abstracting away chain risk from the user
