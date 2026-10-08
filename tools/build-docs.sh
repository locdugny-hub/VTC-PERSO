#!/usr/bin/env bash
# Convertit les guides Markdown en pages HTML autonomes servies par la PWA (disponibles hors connexion).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/docs
CSS='<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:760px;margin:0 auto;padding:16px;color:#0f1b2d}table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}td,th{border:1px solid #d9dee7;padding:6px;vertical-align:top}code{background:#eef1f6;padding:1px 4px;border-radius:4px;word-break:break-all}@media(prefers-color-scheme:dark){body{background:#0b1120;color:#e8edf6}code{background:#1e2638}td,th{border-color:#273248}a{color:#8fb3ff}}</style>'
for f in RACCOURCI GUIDE; do
  pandoc "docs/$f.md" -f gfm -t html5 -s --metadata title="VTC Perso : $f" -H <(echo "$CSS") -o "public/docs/$f.html"
done
echo "docs HTML générés"
