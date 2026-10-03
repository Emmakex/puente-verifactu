#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/kairoseth/local-agent"
CURRENT="$APP_ROOT/current"
CONFIG_FILE="/etc/kairoseth-local-agent/agent.json"
SERVICE="kairoseth-local-agent.service"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG_FILE="$2"; shift 2 ;;
    *) echo "Usage: $0 [--config FILE]" >&2; exit 2 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ -f "$CONFIG_FILE" ]] || { echo "Installed config not found" >&2; exit 2; }
NODE_BIN="$(command -v node)"
DATA_DIR="$("$NODE_BIN" -e "const fs=require('fs'),p=require('path');const f=p.resolve(process.argv[1]);const c=JSON.parse(fs.readFileSync(f,'utf8'));console.log(p.resolve(p.dirname(f),c.dataDir))" "$CONFIG_FILE")"
RECEIPT="$DATA_DIR/upgrades/last-upgrade.json"
[[ -f "$RECEIPT" ]] || { echo "No Local Agent upgrade receipt found" >&2; exit 2; }

PREVIOUS_RELEASE="$("$NODE_BIN" -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(r.previousRelease||'')" "$RECEIPT")"
TARGET_RELEASE="$("$NODE_BIN" -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(r.targetRelease||'')" "$RECEIPT")"

case "$PREVIOUS_RELEASE" in
  "$APP_ROOT"/releases/*) ;;
  *) echo "Unsafe previous release path" >&2; exit 2 ;;
esac
[[ -d "$PREVIOUS_RELEASE" ]] || { echo "Previous code release is unavailable" >&2; exit 2; }

WAS_ACTIVE=0
if systemctl is-active --quiet "$SERVICE"; then
  WAS_ACTIVE=1
  systemctl stop "$SERVICE"
fi

ln -sfn "$PREVIOUS_RELEASE" "$CURRENT"
if [[ $WAS_ACTIVE -eq 1 ]]; then systemctl restart "$SERVICE"; fi

"$NODE_BIN" -e "
const fs=require('fs');
const path=process.argv[1];
const r=JSON.parse(fs.readFileSync(path,'utf8'));
r.rolledBackAt=new Date().toISOString();
r.rolledBackCodeTo=r.previousRelease;
r.databaseRestored=false;
fs.writeFileSync(path, JSON.stringify(r,null,2)+'\n', {mode:0o600});
" "$RECEIPT"
chmod 0600 "$RECEIPT"

printf '{"status":"ok","platform":"linux","rolled_back_from":"%s","rolled_back_to":"%s","database_restored":false}\n' "$TARGET_RELEASE" "$PREVIOUS_RELEASE"
