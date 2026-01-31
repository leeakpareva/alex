#!/bin/bash
# Taildrop auto-receive watcher — saves incoming files to ALEX's uploads directory
# and notifies ALEX via the control API so he has context
DEST="/home/head/.alex/uploads"
mkdir -p "$DEST"
echo "[TAILDROP] Watching for incoming files → $DEST"

while true; do
    # --wait blocks until a file arrives
    tailscale file get --wait --conflict=rename "$DEST" 2>/dev/null

    # Check for new files and notify ALEX
    for f in "$DEST"/.partial-*; do
        [ -f "$f" ] && continue  # skip partial downloads
    done

    # Find files modified in the last 10 seconds (just received)
    while IFS= read -r f; do
        [ -f "$f" ] || continue
        FNAME=$(basename "$f")
        FSIZE=$(stat -c%s "$f")
        echo "[TAILDROP] Received: $FNAME ($FSIZE bytes)"

        # Notify ALEX via control API (fire and forget)
        curl -sf -X POST http://127.0.0.1:9090/api/trigger \
            -H 'Content-Type: application/json' \
            -d "{\"task\":\"file-received\",\"file\":\"$f\",\"filename\":\"$FNAME\"}" \
            >> /home/head/.alex/logs/cron.log 2>&1 &
    done < <(find "$DEST" -maxdepth 1 -type f -newer /tmp/.taildrop-marker 2>/dev/null)

    # Update marker
    touch /tmp/.taildrop-marker
    sleep 1
done
