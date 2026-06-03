#!/usr/bin/env sh
set -e
PORT="${PORT:-30200}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${HUB_DATA_DIR:-$DIR/data}"

echo "Stopping hub on port $PORT..."
lsof -ti:"$PORT" 2>/dev/null | xargs kill 2>/dev/null || true
sleep 0.5

echo "Removing $DATA/hub.db*"
rm -f "$DATA/hub.db" "$DATA/hub.db-wal" "$DATA/hub.db-shm"
echo "Done. Run: cd $DIR && npm start"
