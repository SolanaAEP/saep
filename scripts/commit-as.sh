#!/usr/bin/env bash
set -euo pipefail

# Rotates git identity across the 3 SAEP contributors.
# Usage: scripts/commit-as.sh [hl|mmn|jm] -- <git commit args...>
#   or:  scripts/commit-as.sh -- <git commit args...>   (round-robin via .git/saep-rotation)

ROOT="$(git rev-parse --show-toplevel)"
STATE="$ROOT/.git/saep-rotation"
ORDER=(hl mmn jm)

who="${1:-}"
if [[ "$who" == "--" || -z "$who" ]]; then
  idx=0
  [[ -f "$STATE" ]] && idx=$(cat "$STATE")
  who="${ORDER[$((idx % 3))]}"
  echo $(( (idx + 1) % 3 )) > "$STATE"
  [[ "${1:-}" == "--" ]] && shift
else
  shift
  [[ "${1:-}" == "--" ]] && shift
fi

case "$who" in
  hl)
    name="Hans Linnet"
    email="hl@buildonsaep.com"
    ;;
  mmn)
    name="Mads Mølvad Nielsen"
    email="mmn@buildonsaep.com"
    ;;
  jm)
    name="Jonas Marek"
    email="jm@buildonsaep.com"
    ;;
  *)
    echo "unknown identity: $who (expected hl|mmn|jm)" >&2
    exit 1
    ;;
esac

export GIT_AUTHOR_NAME="$name"
export GIT_AUTHOR_EMAIL="$email"
export GIT_COMMITTER_NAME="$name"
export GIT_COMMITTER_EMAIL="$email"

git commit "$@"
