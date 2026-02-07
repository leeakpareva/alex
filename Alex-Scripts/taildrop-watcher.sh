#!/bin/bash
# Taildrop auto-receive watcher — saves incoming files to ALEX's uploads directory
# and notifies ALEX via the control API so he has context
DEST="/home/head/.alex/uploads"
mkdir -p "$DEST"
touch /tmp/.taildrop-marker
echo "[TAILDROP] Watching for incoming files → $DEST"

# Use --loop to continuously receive files as they arrive
# --verbose to log what's happening
tailscale file get --loop --verbose --conflict=rename "$DEST" 2>&1 | while IFS= read -r line; do
    echo "[TAILDROP] $line"

    # When a file is received, tailscale prints the filename
    # Check for new files modified in the last 10 seconds
    while IFS= read -r f; do
        [ -f "$f" ] || continue
        FNAME=$(basename "$f")
        FSIZE=$(stat -c%s "$f" 2>/dev/null || echo "?")
        echo "[TAILDROP] Received: $FNAME ($FSIZE bytes)"

        # Notify ALEX via control API (fire and forget)
        curl -sf --retry 2 --retry-delay 5 -X POST http://127.0.0.1:9090/api/trigger \
            -H 'Content-Type: application/json' \
            -d "{\"task\":\"file-received\",\"file\":\"$f\",\"filename\":\"$FNAME\"}" \
            >> /home/head/.alex/logs/cron.log 2>&1 &
    done < <(find "$DEST" -maxdepth 1 -type f -newer /tmp/.taildrop-marker 2>/dev/null)

    touch /tmp/.taildrop-marker
done
