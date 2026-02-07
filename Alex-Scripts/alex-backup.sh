#!/usr/bin/env bash
# alex-backup.sh — Daily backup of ~/.alex/ with 7-day local rotation
# and optional weekly Tailscale remote push.
#
# Usage:
#   bash scripts/alex-backup.sh          # local backup only
#   bash scripts/alex-backup.sh --remote  # also push via Tailscale
#
# Cron (daily at 4 AM): 0 4 * * * head /home/head/navada-1/scripts/alex-backup.sh >> /home/head/.alex/logs/backup.log 2>&1

set -euo pipefail

ALEX_DIR="$HOME/.alex"
BACKUP_DIR="$HOME/backups"
RETAIN_DAYS=7
DATE=$(date +%Y-%m-%d)
DAY_OF_WEEK=$(date +%u)  # 1=Monday, 7=Sunday
BACKUP_NAME="alex-backup-${DATE}.tar.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

echo "[BACKUP] $(date '+%Y-%m-%d %H:%M:%S') Starting backup..."

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Create compressed backup, excluding regenerable/ephemeral data
tar czf "$BACKUP_PATH" \
    --exclude='chromadb' \
    --exclude='cache' \
    --exclude='node_modules' \
    --exclude='*.pyc' \
    --exclude='__pycache__' \
    -C "$HOME" .alex/ 2>/dev/null

BACKUP_SIZE=$(du -sh "$BACKUP_PATH" | cut -f1)
echo "[BACKUP] Created: $BACKUP_PATH ($BACKUP_SIZE)"

# Rotate: delete backups older than RETAIN_DAYS
DELETED=0
find "$BACKUP_DIR" -name "alex-backup-*.tar.gz" -mtime +${RETAIN_DAYS} -type f | while read -r old; do
    rm -f "$old"
    DELETED=$((DELETED + 1))
    echo "[BACKUP] Rotated: $(basename "$old")"
done

# Weekly remote push via Tailscale (Sundays, or if --remote flag passed)
if [ "${1:-}" = "--remote" ] || [ "$DAY_OF_WEEK" = "7" ]; then
    if command -v tailscale >/dev/null 2>&1; then
        # Get first available Tailscale peer (adjust target as needed)
        REMOTE_TARGET="${TAILSCALE_BACKUP_TARGET:-}"
        if [ -n "$REMOTE_TARGET" ]; then
            echo "[BACKUP] Pushing to Tailscale peer: $REMOTE_TARGET"
            tailscale file cp "$BACKUP_PATH" "${REMOTE_TARGET}:" && \
                echo "[BACKUP] Remote push successful" || \
                echo "[BACKUP] Remote push failed (non-fatal)"
        else
            echo "[BACKUP] No TAILSCALE_BACKUP_TARGET set — skipping remote push"
        fi
    else
        echo "[BACKUP] Tailscale not available — skipping remote push"
    fi
fi

echo "[BACKUP] $(date '+%Y-%m-%d %H:%M:%S') Done."
