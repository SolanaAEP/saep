#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHROME_APP="${CHROME_APP:-/Applications/Google Chrome.app}"
PROFILE_DIR="${PLAYWRIGHT_WALLET_PROFILE_DIR:-$ROOT_DIR/.playwright-wallet-profile}"
CDP_PORT="${CDP_PORT:-9222}"
BASE_URL="${BASE_URL:-https://buildonsaep.com}"
START_URL="${START_URL:-$BASE_URL/dashboard}"

if [[ ! -d "$CHROME_APP" ]]; then
  echo "Chrome app not found at $CHROME_APP" >&2
  echo "Set CHROME_APP to your browser app bundle, for example /Applications/Google Chrome Canary.app" >&2
  exit 1
fi

mkdir -p "$PROFILE_DIR"

open -na "$CHROME_APP" --args \
  --remote-debugging-port="$CDP_PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  --new-window \
  "$START_URL"

cat <<EOF
Chrome launched with remote debugging on port $CDP_PORT.

Profile:
  $PROFILE_DIR

Next:
1. Install or open your Solana wallet extension in that Chrome window.
2. Unlock the wallet.
3. Visit $START_URL and sign in if needed.
4. Run:
   cd $ROOT_DIR
   CDP_URL=http://127.0.0.1:$CDP_PORT BASE_URL=$BASE_URL pnpm e2e:wallet

Tips:
- Set BASE_URL to point at another environment.
- Set CHROME_APP if you want Chrome Canary or another Chromium-based browser.
- Reuse the same profile dir if you want the wallet extension and session to persist.
EOF
