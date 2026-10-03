#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/kairoseth/local-agent"
CONFIG_ROOT="/etc/kairoseth-local-agent"
DATA_DIR="/var/lib/kairoseth-local-agent"
UNIT_PATH="/etc/systemd/system/kairoseth-local-agent.service"
SERVICE_USER="kairoseth-agent"
BUNDLE_DIR=""
CONFIG_SOURCE=""
ENV_SOURCE=""
ENABLE=0
START=0
REPLACE_CONFIG=0

usage() {
  echo "Usage: $0 --bundle-dir DIR --config-source FILE --env-source FILE [--enable] [--start] [--replace-config]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle-dir) BUNDLE_DIR="$2"; shift 2 ;;
    --config-source) CONFIG_SOURCE="$2"; shift 2 ;;
    --env-source) ENV_SOURCE="$2"; shift 2 ;;
    --enable) ENABLE=1; shift ;;
    --start) START=1; ENABLE=1; shift ;;
    --replace-config) REPLACE_CONFIG=1; shift ;;
    *) usage; exit 2 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ -d "$BUNDLE_DIR" && -f "$BUNDLE_DIR/bundle-manifest.json" ]] || { usage; exit 2; }
BUNDLE_DIR="$(cd "$BUNDLE_DIR" && pwd -P)"
[[ -f "$CONFIG_SOURCE" && -f "$ENV_SOURCE" ]] || { usage; exit 2; }
command -v node >/dev/null
command -v npm >/dev/null
command -v systemctl >/dev/null

NODE_BIN="$(command -v node)"
VERSION="$(node -e "const m=require(process.argv[1]); if(!m.version)process.exit(2); console.log(m.version)" "$BUNDLE_DIR/bundle-manifest.json")"
COMMIT="$(node -e "const m=require(process.argv[1]); if(!/^[0-9a-f]{40}$/.test(m.sourceCommit))process.exit(2); console.log(m.sourceCommit)" "$BUNDLE_DIR/bundle-manifest.json")"
RELEASE_DIR="$APP_ROOT/releases/$VERSION-$COMMIT"
CURRENT="$APP_ROOT/current"
CONFIG_FILE="$CONFIG_ROOT/agent.json"
ENV_FILE="$CONFIG_ROOT/agent.env"

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

install -d -m 0755 "$APP_ROOT/releases" "$CONFIG_ROOT"
install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"

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
  install -m 0600 -o "$SERVICE_USER" -g "$SERVICE_USER" "$CONFIG_SOURCE" "$CONFIG_FILE"
fi
install -m 0600 -o root -g root "$ENV_SOURCE" "$ENV_FILE"

sed   -e "s|__SERVICE_USER__|$SERVICE_USER|g"   -e "s|__APP_CURRENT__|$CURRENT|g"   -e "s|__ENV_FILE__|$ENV_FILE|g"   -e "s|__CONFIG_FILE__|$CONFIG_FILE|g"   -e "s|__NODE_BIN__|$NODE_BIN|g"   -e "s|__DATA_DIR__|$DATA_DIR|g"   "$CURRENT/packages/local-agent/service/linux/kairoseth-local-agent.service.template" > "$UNIT_PATH"
chmod 0644 "$UNIT_PATH"
systemctl daemon-reload
if [[ $ENABLE -eq 1 ]]; then systemctl enable kairoseth-local-agent.service; fi
if [[ $START -eq 1 ]]; then systemctl restart kairoseth-local-agent.service; fi

printf '{"status":"ok","platform":"linux","release":"%s","config_preserved":true,"data_preserved":true}\n' "$VERSION-$COMMIT"
