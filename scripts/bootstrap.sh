#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo ">> rust:    $(rustc --version)"
echo ">> solana:  $(solana --version)"
echo ">> anchor:  $(anchor --version)"
echo ">> node:    $(node --version)"
echo ">> pnpm:    $(pnpm --version)"

pnpm install --frozen-lockfile=false
anchor build
pnpm -r build

echo
echo "bootstrap complete."
echo "run 'pnpm --filter @saep/portal dev' to launch the portal on :3000"
