#!/usr/bin/env bash
set -euo pipefail

BUNDLE_ROOT="${1:-}"
[[ -d "$BUNDLE_ROOT" ]] || { echo "bundle root required" >&2; exit 2; }

INSTALLER="$BUNDLE_ROOT/packages/local-agent/service/linux/install.sh"
UNINSTALLER="$BUNDLE_ROOT/packages/local-agent/service/linux/uninstall.sh"
[[ -f "$INSTALLER" && -f "$UNINSTALLER" ]] || { echo "Linux service scripts missing from bundle" >&2; exit 2; }

FIXTURE="$(mktemp -d)"
CONFIG_ONE="$FIXTURE/agent-one.json"
CONFIG_TWO="$FIXTURE/agent-two.json"
ENV_FILE="$FIXTURE/agent.env"

cleanup() {
  sudo bash "$UNINSTALLER" >/dev/null 2>&1 || true
  sudo rm -rf /etc/kairoseth-local-agent /var/lib/kairoseth-local-agent
  sudo userdel kairoseth-agent >/dev/null 2>&1 || true
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

sudo bash "$INSTALLER" --bundle-dir "$BUNDLE_ROOT" --config-source "$CONFIG_ONE" --env-source "$ENV_FILE" >/tmp/pv-linux-install-1.json

[[ -L /opt/kairoseth/local-agent/current ]]
[[ -f /etc/systemd/system/kairoseth-local-agent.service ]]
[[ -f /etc/kairoseth-local-agent/agent.json ]]
[[ -f /etc/kairoseth-local-agent/agent.env ]]
[[ -d /var/lib/kairoseth-local-agent ]]

sudo sh -c 'printf "state-survives\n" > /var/lib/kairoseth-local-agent/state-marker'
sudo chown kairoseth-agent:kairoseth-agent /var/lib/kairoseth-local-agent/state-marker

sudo bash "$INSTALLER" --bundle-dir "$BUNDLE_ROOT" --config-source "$CONFIG_TWO" --env-source "$ENV_FILE" >/tmp/pv-linux-install-2.json

sudo grep -q '"marker":"first"' /etc/kairoseth-local-agent/agent.json
sudo grep -q 'state-survives' /var/lib/kairoseth-local-agent/state-marker

sudo bash "$UNINSTALLER" >/tmp/pv-linux-uninstall.json

[[ ! -e /opt/kairoseth/local-agent ]]
[[ ! -e /etc/systemd/system/kairoseth-local-agent.service ]]
[[ -f /etc/kairoseth-local-agent/agent.json ]]
[[ -f /etc/kairoseth-local-agent/agent.env ]]
[[ -f /var/lib/kairoseth-local-agent/state-marker ]]
grep -q '"marker":"first"' /etc/kairoseth-local-agent/agent.json
grep -q 'state-survives' /var/lib/kairoseth-local-agent/state-marker

mode_config="$(sudo stat -c '%a' /etc/kairoseth-local-agent/agent.json)"
mode_env="$(sudo stat -c '%a' /etc/kairoseth-local-agent/agent.env)"
[[ "$mode_config" == "600" ]]
[[ "$mode_env" == "600" ]]

printf '{"status":"ok","check":"local-agent-service-linux","install_idempotent":true,"config_preserved":true,"data_preserved":true,"config_mode":"%s","env_mode":"%s"}\n' "$mode_config" "$mode_env"
