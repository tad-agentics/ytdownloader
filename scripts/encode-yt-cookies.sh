#!/usr/bin/env bash
set -euo pipefail

FILE="${1:-cookies.txt}"
if [[ ! -f "$FILE" ]]; then
  echo "Usage: $0 [cookies.txt]"
  echo "Export Netscape cookies from your browser, then run this script."
  exit 1
fi

echo "Add this line to .env.local (single line):"
echo ""
echo -n "YT_DLP_COOKIES_B64="
base64 < "$FILE" | tr -d '\n'
echo ""
echo ""
echo "Or for local dev only:"
echo "YT_DLP_COOKIES_FILE=$FILE"
