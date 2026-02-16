#!/usr/bin/env bash
# Taildrop watcher — receives files via Tailscale and triggers ALEX processing
# Runs as root (Tailscale file get requires it)

set -euo pipefail

UPLOAD_DIR="/home/head/.alex/uploads"
ALEX_API="http://127.0.0.1:9090/api/trigger"
LOG="/home/head/.alex/logs/taildrop.log"

mkdir -p "$UPLOAD_DIR" "$(dirname "$LOG")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

log "Taildrop watcher started — waiting for files..."

while true; do
    # Wait for and receive files from Tailscale (blocks until a file arrives)
    if tailscale file get --wait --conflict=rename "$UPLOAD_DIR" 2>>"$LOG"; then
        # Find files modified in the last 60 seconds (just received)
        while IFS= read -r -d '' file; do
            filename=$(basename "$file")
            log "Received: $filename"

            # Fix ownership (tailscale file get runs as root)
            chown head:head "$file" 2>/dev/null || true

            # Notify ALEX to process the file
            curl -s -X POST "$ALEX_API" \
                -H 'Content-Type: application/json' \
                -d "{\"task\":\"file-received\",\"file\":\"$file\"}" \
                --retry 3 --retry-delay 5 --retry-connrefused \
                >> "$LOG" 2>&1 || log "Failed to notify ALEX about $filename"

            log "Triggered processing for: $filename"
        done < <(find "$UPLOAD_DIR" -maxdepth 1 -type f -mmin -1 -print0 2>/dev/null)
    else
        log "tailscale file get failed (exit $?) — retrying in 5s"
        sleep 5
    fi
done
