#!/usr/bin/env bash
set -e

PORT="${1:-8080}"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Dev Dashboard → http://localhost:$PORT"
echo "Ctrl+C para parar"
echo ""

python3 -m http.server "$PORT" --directory "$DIR"
