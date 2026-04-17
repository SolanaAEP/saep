#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

ok()   { printf "${GREEN}✓${NC} %s\n" "$1"; }
fail() { printf "${RED}✗${NC} %s\n" "$1"; exit 1; }

# prereq checks
command -v rustc  >/dev/null 2>&1 || fail "rustc not found — install via https://rustup.rs"
command -v solana >/dev/null 2>&1 || fail "solana CLI not found — install via https://docs.solanalabs.com/cli/install"
command -v anchor >/dev/null 2>&1 || fail "anchor CLI not found — install via: cargo install --git https://github.com/coral-xyz/anchor --tag v1.0.0 anchor-cli --locked"
command -v node   >/dev/null 2>&1 || fail "node not found — install Node 22+ via https://nodejs.org"
command -v pnpm   >/dev/null 2>&1 || fail "pnpm not found — install via: corepack enable && corepack prepare pnpm@10.31.0 --activate"

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
[ "$NODE_MAJOR" -ge 22 ] || fail "Node 22+ required (found v$(node --version))"

ok "rust:    $(rustc --version)"
ok "solana:  $(solana --version)"
ok "anchor:  $(anchor --version)"
ok "node:    $(node --version)"
ok "pnpm:    $(pnpm --version)"

# env setup
if [ ! -f .env ]; then
  cp .env.example .env
  ok ".env created from .env.example — edit with your keys"
else
  ok ".env already exists"
fi

# install + build
echo
echo ">> installing dependencies..."
pnpm install --frozen-lockfile

echo
echo ">> building anchor programs..."
anchor build

echo
echo ">> building packages..."
pnpm -r build

echo
printf "\n${GREEN}bootstrap complete.${NC}\n\n"
echo "next steps:"
echo "  docker compose up -d              # start postgres + redis"
echo "  anchor test                        # run on-chain integration tests"
echo "  pnpm --filter @saep/portal dev     # portal on :3000"
echo "  pnpm test                          # run all tests"
echo
