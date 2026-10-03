#!/usr/bin/env bash
set -euo pipefail

BUNDLE_ROOT="${1:-}"
[[ -d "$BUNDLE_ROOT" ]] || { echo "bundle root required" >&2; exit 2; }

INSTALLER="$BUNDLE_ROOT/packages/local-agent/service/macos/install.sh"
UNINSTALLER="$BUNDLE_ROOT/packages/local-agent/service/macos/uninstall.sh"
[[ -f "$INSTALLER" && -f "$UNINSTALLER" ]] || { echo "macOS service scripts missing from bundle" >&2; exit 2; }

FIXTURE="$(mktemp -d)"
CONFIG_ONE="$FIXTURE/agent-one.json"
CONFIG_TWO="$FIXTURE/agent-two.json"
ENV_FILE="$FIXTURE/agent.env"
SERVICE_USER="$(id -un)"
STATE_ROOT="/Library/Application Support/Kairoseth/LocalAgent"
CONFIG_FILE="$STATE_ROOT/config/agent.json"
INSTALLED_ENV="$STATE_ROOT/config/agent.env"
DATA_DIR="$STATE_ROOT/data"

cleanup() {
  sudo bash "$UNINSTALLER" >/dev/null 2>&1 || true
  sudo rm -rf "$STATE_ROOT"
  rm -rf "$FIXTURE"
}
trap cleanup EXIT

cat > "$CONFIG_ONE" <<'JSON'
{"schemaVersion":1,"marker":"first"}
JSON
cat > "$CONFIG_TWO" <<'JSON'
{"schemaVersion":1,"marker":"second"}
JSON
cat > "$ENV_FILE" <<'ENV'
PV_LOCAL_AGENT_API_KEY=service-smoke
ENV

sudo bash "$INSTALLER" --bundle-dir "$BUNDLE_ROOT" --config-source "$CONFIG_ONE" --env-source "$ENV_FILE" --service-user "$SERVICE_USER" >/tmp/pv-macos-install-1.json

[[ -L /Library/Kairoseth/LocalAgent/current ]]
[[ -f /Library/LaunchDaemons/com.kairoseth.local-agent.plist ]]
[[ -f "$CONFIG_FILE" ]]
[[ -f "$INSTALLED_ENV" ]]
[[ -d "$DATA_DIR" ]]
plutil -lint /Library/LaunchDaemons/com.kairoseth.local-agent.plist >/dev/null

sudo sh -c 'printf "state-survives\n" > "/Library/Application Support/Kairoseth/LocalAgent/data/state-marker"'
sudo chown "$SERVICE_USER" "$DATA_DIR/state-marker"

sudo bash "$INSTALLER" --bundle-dir "$BUNDLE_ROOT" --config-source "$CONFIG_TWO" --env-source "$ENV_FILE" --service-user "$SERVICE_USER" >/tmp/pv-macos-install-2.json

grep -q '"marker":"first"' "$CONFIG_FILE"
grep -q "state-survives" "$DATA_DIR/state-marker"

sudo bash "$UNINSTALLER" >/tmp/pv-macos-uninstall.json

[[ ! -e /Library/Kairoseth/LocalAgent ]]
[[ ! -e /Library/LaunchDaemons/com.kairoseth.local-agent.plist ]]
[[ -f "$CONFIG_FILE" ]]
[[ -f "$INSTALLED_ENV" ]]
[[ -f "$DATA_DIR/state-marker" ]]
grep -q '"marker":"first"' "$CONFIG_FILE"
grep -q "state-survives" "$DATA_DIR/state-marker"

mode_config="$(stat -f '%Lp' "$CONFIG_FILE")"
mode_env="$(stat -f '%Lp' "$INSTALLED_ENV")"
[[ "$mode_config" == "600" ]]
[[ "$mode_env" == "600" ]]

printf '{"status":"ok","check":"local-agent-service-macos","install_idempotent":true,"config_preserved":true,"data_preserved":true,"config_mode":"%s","env_mode":"%s"}\n' "$mode_config" "$mode_env"
