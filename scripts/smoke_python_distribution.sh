#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
HERMES_AGENT_PIP_SPEC="${HERMES_AGENT_PIP_SPEC:-git+https://github.com/NousResearch/hermes-agent.git}"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/saep-python-dist-XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT

require_python() {
  "$PYTHON_BIN" - <<'PY'
import sys
if sys.version_info < (3, 11):
    raise SystemExit(f"Python 3.11+ is required for hermes-saep-plugin; got {sys.version.split()[0]}")
PY
}

build_artifacts() {
  local build_env="$WORKDIR/build-env"
  "$PYTHON_BIN" -m venv "$build_env"
  # shellcheck disable=SC1090
  source "$build_env/bin/activate"
  python -m pip install --upgrade pip build
  (
    cd "$ROOT/python/saep-sdk"
    python -m build --sdist --wheel --outdir "$WORKDIR/saep-sdk"
  )
  (
    cd "$ROOT/python/hermes-saep-plugin"
    python -m build --sdist --wheel --outdir "$WORKDIR/hermes-saep-plugin"
  )
  deactivate
}

configure_hermes_home() {
  local home_dir="$1"
  mkdir -p "$home_dir"
  printf 'plugins:\n  enabled:\n    - saep\n' >"$home_dir/config.yaml"
}

run_install_smoke() {
  local kind="$1"
  local artifact_ext="$2"
  local venv_dir="$WORKDIR/${kind}-env"
  local hermes_home="$WORKDIR/hermes-home-${kind}"
  local sdk_artifact
  local hermes_artifact

  sdk_artifact="$(find "$WORKDIR/saep-sdk" -maxdepth 1 -type f -name "*.${artifact_ext}" | head -n 1)"
  hermes_artifact="$(find "$WORKDIR/hermes-saep-plugin" -maxdepth 1 -type f -name "*.${artifact_ext}" | head -n 1)"

  if [[ -z "$sdk_artifact" || -z "$hermes_artifact" ]]; then
    echo "missing ${kind} artifact(s)"
    exit 1
  fi

  "$PYTHON_BIN" -m venv "$venv_dir"
  # shellcheck disable=SC1090
  source "$venv_dir/bin/activate"
  python -m pip install --upgrade pip
  python -m pip install "$HERMES_AGENT_PIP_SPEC"
  python -m pip install "$sdk_artifact" "$hermes_artifact"

  configure_hermes_home "$hermes_home"

  export HERMES_HOME="$hermes_home"
  export SAEP_DISCOVERY_URL="https://buildonsaep.com/api/discovery/v1/discovery"
  export SAEP_MCP_BRIDGE_COMMAND_JSON='["python","-c","print(\"bridge-ready\")"]'

  python "$ROOT/python/hermes-saep-plugin/examples/discover_entrypoint.py"
  python "$ROOT/python/hermes-saep-plugin/examples/write_surface_smoke.py"

  python - <<'PY'
import importlib.metadata as metadata
import hermes_saep_plugin
import saep_sdk

eps = metadata.entry_points()
if hasattr(eps, "select"):
    group = eps.select(group="hermes_agent.plugins")
else:
    group = eps.get("hermes_agent.plugins", [])

plugin = next((entry for entry in group if entry.name == "saep"), None)
if plugin is None:
    raise SystemExit("saep Hermes entry point missing after artifact install")

print("artifact smoke ok", saep_sdk.__name__, hermes_saep_plugin.__name__, plugin.value)
PY

  deactivate
}

echo "python_bin: $PYTHON_BIN"
echo "workspace: $WORKDIR"
require_python
build_artifacts
run_install_smoke "wheel" "whl"
run_install_smoke "sdist" "tar.gz"
echo "python distribution smoke passed"
