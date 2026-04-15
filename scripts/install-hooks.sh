#!/usr/bin/env bash
# Wires scripts/git-hooks as the repo's hook path. Idempotent.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

chmod +x scripts/git-hooks/*
git config --local core.hooksPath scripts/git-hooks

echo "[install-hooks] core.hooksPath = $(git config --local --get core.hooksPath)"
echo "[install-hooks] hooks:"
ls -la scripts/git-hooks/
