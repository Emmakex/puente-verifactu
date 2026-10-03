#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/Library/Kairoseth/LocalAgent"
STATE_ROOT="/Library/Application Support/Kairoseth/LocalAgent"
PLIST="/Library/LaunchDaemons/com.kairoseth.local-agent.plist"
BUNDLE_DIR=""
CONFIG_SOURCE=""
ENV_SOURCE=""
SERVICE_USER="${SUDO_USER:-}"
ENABLE=0
START=0
REPLACE_CONFIG=0

usage() {
  echo "Usage: sudo $0 --bundle-dir DIR --config-source FILE --env-source FILE [--service-user USER] [--enable] [--start] [--replace-config]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle-dir) BUNDLE_DIR="$2"; shift 2 ;;
    --config-source) CONFIG_SOURCE="$2"; shift 2 ;;
    --env-source) ENV_SOURCE="$2"; shift 2 ;;
    --service-user) SERVICE_USER="$2"; shift 2 ;;
    --enable) ENABLE=1; shift ;;
    --start) START=1; ENABLE=1; shift ;;
    --replace-config) REPLACE_CONFIG=1; shift ;;
    *) usage; exit 2 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Run with sudo" >&2; exit 1; }
[[ -n "$SERVICE_USER" && "$SERVICE_USER" != "root" ]] || { echo "--service-user must be a non-root local account" >&2; exit 2; }
id "$SERVICE_USER" >/dev/null
[[ -d "$BUNDLE_DIR" && -f "$BUNDLE_DIR/bundle-manifest.json" && -f "$CONFIG_SOURCE" && -f "$ENV_SOURCE" ]] || { usage; exit 2; }
BUNDLE_DIR="$(cd "$BUNDLE_DIR" && pwd -P)"
command -v node >/dev/null
command -v npm >/dev/null
command -v launchctl >/dev/null

NODE_BIN="$(command -v node)"
VERSION="$(node -e "const m=require(process.argv[1]); if(!m.version)process.exit(2); console.log(m.version)" "$BUNDLE_DIR/bundle-manifest.json")"
COMMIT="$(node -e "const m=require(process.argv[1]); if(!/^[0-9a-f]{40}$/.test(m.sourceCommit))process.exit(2); console.log(m.sourceCommit)" "$BUNDLE_DIR/bundle-manifest.json")"
RELEASE_DIR="$APP_ROOT/releases/$VERSION-$COMMIT"
CURRENT="$APP_ROOT/current"
CONFIG_DIR="$STATE_ROOT/config"
CONFIG_FILE="$CONFIG_DIR/agent.json"
ENV_FILE="$CONFIG_DIR/agent.env"
DATA_DIR="$STATE_ROOT/data"
RUNNER="$APP_ROOT/bin/run.sh"

install -d -m 0755 "$APP_ROOT/releases" "$APP_ROOT/bin"
install -d -m 0700 -o "$SERVICE_USER" "$CONFIG_DIR" "$DATA_DIR"

if [[ ! -d "$RELEASE_DIR" ]]; then
  TMP="$RELEASE_DIR.tmp"
  rm -rf "$TMP"
  install -d -m 0755 "$TMP"
  cp -a "$BUNDLE_DIR/." "$TMP/"
  npm --prefix "$TMP" install --omit=dev --ignore-scripts --package-lock=false
  mv "$TMP" "$RELEASE_DIR"
fi
ln -sfn "$RELEASE_DIR" "$CURRENT"

if [[ ! -f "$CONFIG_FILE" || $REPLACE_CONFIG -eq 1 ]]; then
  install -m 0600 -o "$SERVICE_USER" "$CONFIG_SOURCE" "$CONFIG_FILE"
fi
install -m 0600 -o "$SERVICE_USER" "$ENV_SOURCE" "$ENV_FILE"

sed   -e "s|__ENV_FILE__|$ENV_FILE|g"   -e "s|__NODE_BIN__|$NODE_BIN|g"   -e "s|__APP_CURRENT__|$CURRENT|g"   -e "s|__CONFIG_FILE__|$CONFIG_FILE|g"   "$CURRENT/packages/local-agent/service/macos/run.sh.template" > "$RUNNER"
chmod 0755 "$RUNNER"
chown root:wheel "$RUNNER"

sed   -e "s|__SERVICE_USER__|$SERVICE_USER|g"   -e "s|__RUNNER__|$RUNNER|g"   -e "s|__APP_CURRENT__|$CURRENT|g"   "$CURRENT/packages/local-agent/service/macos/com.kairoseth.local-agent.plist.template" > "$PLIST"
chown root:wheel "$PLIST"
chmod 0644 "$PLIST"
plutil -lint "$PLIST" >/dev/null

if [[ $ENABLE -eq 1 ]]; then
  launchctl bootout system/com.kairoseth.local-agent 2>/dev/null || true
  launchctl bootstrap system "$PLIST"
  if [[ $START -eq 1 ]]; then launchctl kickstart -k system/com.kairoseth.local-agent; fi
fi

printf '{"status":"ok","platform":"macos","release":"%s","service_user":"%s","config_preserved":true,"data_preserved":true}\n' "$VERSION-$COMMIT" "$SERVICE_USER"
