#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo" >&2; exit 1; }
launchctl bootout system/com.kairoseth.local-agent 2>/dev/null || true
rm -f /Library/LaunchDaemons/com.kairoseth.local-agent.plist
rm -rf /Library/Kairoseth/LocalAgent
printf '{"status":"ok","platform":"macos","preserved":["/Library/Application Support/Kairoseth/LocalAgent"]}\n'
