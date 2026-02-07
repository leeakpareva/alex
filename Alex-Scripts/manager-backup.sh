#!/bin/bash
# ALEX Weekly Backup — creates local backup on Pi + sends copy to iPhone via Tailscale
# Usage: ./backup.sh              (run both local + iPhone)
#        ./backup.sh --local      (Pi only)
#        ./backup.sh --iphone     (iPhone only, uses latest local backup)

set -euo pipefail

BACKUP_DIR="/home/head/backups"
DATE=$(date +%Y-%m-%d)
DAY_NAME=$(date +%A)
BACKUP_NAME="alex-backup-${DATE}.tar.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"
IPHONE_TARGET="iphone-15-pro-max"
LOG_FILE="${BACKUP_DIR}/backup.log"
MAX_BACKUPS=8  # Keep last 8 weekly backups

mkdir -p "$BACKUP_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

do_local_backup() {
    log "Starting local backup..."

    tar czf "$BACKUP_PATH" \
        --exclude='node_modules' \
        --exclude='.git' \
        --exclude='__pycache__' \
        --exclude='*.pyc' \
        --exclude='venv' \
        --exclude='chromadb' \
        -C /home/head \
        navada-1 \
        .alex \
        ALEX_NAVADA \
        alex-terminal \
        .env \
        2>/dev/null || true

    SIZE=$(du -sh "$BACKUP_PATH" | cut -f1)
    log "Local backup complete: ${BACKUP_PATH} (${SIZE})"

    # Rotate old backups — keep last MAX_BACKUPS
    BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/alex-backup-*.tar.gz 2>/dev/null | wc -l)
    if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
        ls -1t "$BACKUP_DIR"/alex-backup-*.tar.gz | tail -n +$((MAX_BACKUPS + 1)) | while read old; do
            log "Removing old backup: $(basename "$old")"
            rm -f "$old"
        done
    fi
}

do_iphone_backup() {
    # Use today's backup if it exists, otherwise use the latest
    if [ -f "$BACKUP_PATH" ]; then
        SEND_FILE="$BACKUP_PATH"
    else
        SEND_FILE=$(ls -1t "$BACKUP_DIR"/alex-backup-*.tar.gz 2>/dev/null | head -1)
    fi

    if [ -z "$SEND_FILE" ] || [ ! -f "$SEND_FILE" ]; then
        log "ERROR: No backup file found to send to iPhone"
        exit 1
    fi

    log "Sending $(basename "$SEND_FILE") to iPhone via Tailscale..."

    if tailscale file cp "$SEND_FILE" "${IPHONE_TARGET}:" 2>&1; then
        log "iPhone backup sent successfully"
    else
        log "WARNING: Failed to send to iPhone (device may be offline)"
    fi
}

# Parse args
MODE="${1:-all}"

case "$MODE" in
    --local)
        do_local_backup
        ;;
    --iphone)
        do_iphone_backup
        ;;
    *)
        do_local_backup
        do_iphone_backup
        ;;
esac

log "Backup complete."
