#!/bin/bash
# Legion Web — quick start
set -e

PORT=${1:-3000}
DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  ┌─────────────────────────────┐"
echo "  │  LEGION  Web Platform       │"
echo "  └─────────────────────────────┘"

python3 "$DIR/server.py" "$PORT"
