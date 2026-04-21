#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

FAILED=0
GIVEN_NAME_PART_A='den'
GIVEN_NAME_PART_B='nis'
FAMILY_NAME_PART_A='gos'
FAMILY_NAME_PART_B='lar'
PATTERN="${GIVEN_NAME_PART_A}${GIVEN_NAME_PART_B}[ -]?${FAMILY_NAME_PART_A}${FAMILY_NAME_PART_B}"

usage() {
  cat >&2 <<'EOF'
Usage:
  scripts/check-forbidden-public-identifiers.sh --repo
  scripts/check-forbidden-public-identifiers.sh --staged
  scripts/check-forbidden-public-identifiers.sh --git-ident
  scripts/check-forbidden-public-identifiers.sh --branch-name [NAME]
  scripts/check-forbidden-public-identifiers.sh --commit-message-file PATH
  scripts/check-forbidden-public-identifiers.sh --rev-spec SPEC
EOF
  exit 2
}

report_hits() {
  local scope="$1"
  local hits="$2"

  if [ -z "$hits" ]; then
    return 0
  fi

  FAILED=1
  cat >&2 <<EOF
[public-id-guard] BLOCKED: forbidden public identifiers detected in $scope.

$hits
EOF
}

scan_path_stream() {
  local scope="$1"
  local path
  local hits=""

  while IFS= read -r -d '' path; do
    if printf '%s\n' "$path" | LC_ALL=C grep -E -i "$PATTERN" >/dev/null; then
      hits="${hits}${path}"$'\n'
    fi
  done

  report_hits "$scope" "$hits"
}

scan_repo() {
  local content_hits
  content_hits="$(git grep -n -I -i -E -e "$PATTERN" -- . || true)"
  report_hits "tracked file contents" "$content_hits"
  scan_path_stream "tracked file paths" < <(git ls-files -z)
}

scan_staged() {
  local content_hits
  content_hits="$(git grep --cached -n -I -i -E -e "$PATTERN" -- . || true)"
  report_hits "staged file contents" "$content_hits"
  scan_path_stream "staged file paths" < <(git diff --cached --name-only --diff-filter=ACMR -z)
}

scan_git_ident() {
  local author committer hits=""
  author="$(git var GIT_AUTHOR_IDENT 2>/dev/null || true)"
  committer="$(git var GIT_COMMITTER_IDENT 2>/dev/null || true)"

  if printf '%s\n' "$author" | LC_ALL=C grep -E -i "$PATTERN" >/dev/null; then
    hits="${hits}author: ${author}"$'\n'
  fi

  if printf '%s\n' "$committer" | LC_ALL=C grep -E -i "$PATTERN" >/dev/null; then
    hits="${hits}committer: ${committer}"$'\n'
  fi

  report_hits "git author/committer identity" "$hits"
}

scan_branch_name() {
  local branch="${1:-$(git branch --show-current)}"

  if [ -z "$branch" ]; then
    return 0
  fi

  if printf '%s\n' "$branch" | LC_ALL=C grep -E -i "$PATTERN" >/dev/null; then
    report_hits "branch name" "$branch"
  fi
}

scan_commit_message_file() {
  local path="${1:-}"
  local hits

  [ -n "$path" ] || usage
  hits="$(LC_ALL=C grep -n -E -i "$PATTERN" "$path" || true)"
  report_hits "commit message" "$hits"
}

scan_rev_spec() {
  local spec="${1:-}"
  local hits

  [ -n "$spec" ] || usage
  hits="$(
    git log --format='%H%x09author=%an <%ae>%x09committer=%cn <%ce>%n%s%n%b' $spec 2>/dev/null \
      | LC_ALL=C grep -n -E -i "$PATTERN" || true
  )"
  report_hits "commit history ($spec)" "$hits"
}

main() {
  if [ "$#" -eq 0 ]; then
    usage
  fi

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --repo)
        scan_repo
        shift
        ;;
      --staged)
        scan_staged
        shift
        ;;
      --git-ident)
        scan_git_ident
        shift
        ;;
      --branch-name)
        if [ "$#" -gt 1 ] && [[ "${2:-}" != --* ]]; then
          scan_branch_name "$2"
          shift 2
        else
          scan_branch_name
          shift
        fi
        ;;
      --commit-message-file)
        [ "$#" -gt 1 ] || usage
        scan_commit_message_file "$2"
        shift 2
        ;;
      --rev-spec)
        [ "$#" -gt 1 ] || usage
        scan_rev_spec "$2"
        shift 2
        ;;
      *)
        usage
        ;;
    esac
  done

  if [ "$FAILED" -ne 0 ]; then
    cat >&2 <<'EOF'
[public-id-guard] Remove or replace the blocked identifiers before committing or pushing.
If this is intentional for a private/local-only context, keep it out of the public repo.
EOF
    exit 1
  fi
}

main "$@"
