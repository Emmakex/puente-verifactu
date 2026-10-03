#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/kairoseth/local-agent"
CURRENT="$APP_ROOT/current"
CONFIG_FILE="/etc/kairoseth-local-agent/agent.json"
SERVICE="kairoseth-local-agent.service"
BUNDLE_DIR=""

usage() {
  echo "Usage: $0 --bundle-dir DIR [--config FILE]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle-dir) BUNDLE_DIR="$2"; shift 2 ;;
    --config) CONFIG_FILE="$2"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ -d "$BUNDLE_DIR" && -f "$BUNDLE_DIR/bundle-manifest.json" ]] || { usage; exit 2; }
[[ -f "$CONFIG_FILE" ]] || { echo "Installed config not found" >&2; exit 2; }
[[ -L "$CURRENT" ]] || { echo "Current Local Agent release is not installed" >&2; exit 2; }
BUNDLE_DIR="$(cd "$BUNDLE_DIR" && pwd -P)"

NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"
PREVIOUS_RELEASE="$(readlink -f "$CURRENT")"
VERSION="$("$NODE_BIN" -e "const m=require(process.argv[1]); if(!m.version)process.exit(2); console.log(m.version)" "$BUNDLE_DIR/bundle-manifest.json")"
COMMIT="$("$NODE_BIN" -e "const m=require(process.argv[1]); if(!/^[0-9a-f]{40}$/.test(m.sourceCommit))process.exit(2); console.log(m.sourceCommit)" "$BUNDLE_DIR/bundle-manifest.json")"
TARGET_RELEASE="$APP_ROOT/releases/$VERSION-$COMMIT"
DATA_DIR="$("$NODE_BIN" -e "const fs=require('fs'),p=require('path');const f=p.resolve(process.argv[1]);const c=JSON.parse(fs.readFileSync(f,'utf8'));console.log(p.resolve(p.dirname(f),c.dataDir))" "$CONFIG_FILE")"
RECEIPT_DIR="$DATA_DIR/upgrades"
RECEIPT="$RECEIPT_DIR/last-upgrade.json"

WAS_ACTIVE=0
if systemctl is-active --quiet "$SERVICE"; then
  WAS_ACTIVE=1
  systemctl stop "$SERVICE"
fi

ACTIVATED=0
recover_on_error() {
  status=$?
  if [[ $status -ne 0 ]]; then
    if [[ $ACTIVATED -eq 1 && -d "$PREVIOUS_RELEASE" ]]; then
      ln -sfn "$PREVIOUS_RELEASE" "$CURRENT"
    fi
    if [[ $WAS_ACTIVE -eq 1 ]]; then
      systemctl restart "$SERVICE" >/dev/null 2>&1 || true
    fi
  fi
  exit $status
}
trap recover_on_error ERR

PREPARE_JSON="$("$NODE_BIN" "$BUNDLE_DIR/packages/local-agent/src/upgrade-cli.mjs" prepare   --manifest "$BUNDLE_DIR/bundle-manifest.json"   --config "$CONFIG_FILE")"
BACKUP_PATH="$("$NODE_BIN" -e "const r=JSON.parse(process.argv[1]);console.log(r.backup?.backupPath||'')" "$PREPARE_JSON")"

if [[ ! -d "$TARGET_RELEASE" ]]; then
  TMP="$TARGET_RELEASE.tmp"
  rm -rf "$TMP"
  install -d -m 0755 "$TMP"
  cp -a "$BUNDLE_DIR/." "$TMP/"
  "$NPM_BIN" --prefix "$TMP" install --omit=dev --ignore-scripts --package-lock=false
  mv "$TMP" "$TARGET_RELEASE"
fi

ln -sfn "$TARGET_RELEASE" "$CURRENT"
ACTIVATED=1

install -d -m 0700 "$RECEIPT_DIR"
"$NODE_BIN" -e "
const fs=require('fs');
const [path,previous,target,backup,commit,version]=process.argv.slice(1);
fs.writeFileSync(path, JSON.stringify({
  schemaVersion:1,
  previousRelease:previous,
  targetRelease:target,
  backupPath:backup||null,
  sourceCommit:commit,
  version,
  rollbackPolicy:'code-only',
  automaticDatabaseRollback:false,
  activatedAt:new Date().toISOString()
}, null, 2)+'\n', {mode:0o600});
" "$RECEIPT" "$PREVIOUS_RELEASE" "$TARGET_RELEASE" "$BACKUP_PATH" "$COMMIT" "$VERSION"
chmod 0600 "$RECEIPT"

if [[ $WAS_ACTIVE -eq 1 ]]; then
  if ! systemctl restart "$SERVICE"; then
    ln -sfn "$PREVIOUS_RELEASE" "$CURRENT"
    systemctl restart "$SERVICE" >/dev/null 2>&1 || true
    echo "New release failed to restart; code pointer restored. SQLite was not rolled back." >&2
    exit 1
  fi
fi

trap - ERR
printf '{"status":"ok","platform":"linux","previous_release":"%s","target_release":"%s","backup_path":"%s","rollback_policy":"code-only","database_rollback":false}\n' "$PREVIOUS_RELEASE" "$TARGET_RELEASE" "$BACKUP_PATH"
