#!/usr/bin/env bash
# update-json-index.sh — Generates a summary of all JSON files used by ALEX
# Runs via cron every 30 minutes. Can also be run manually:
#   bash Alex-Scripts/update-json-index.sh

set -euo pipefail

PROJECT_DIR="/home/head/navada-1"
ALEX_DIR="$HOME/.alex"
OUTPUT="$PROJECT_DIR/Json/JSON-INDEX.txt"
PREVIOUS="$PROJECT_DIR/Json/.json-previous-count"

# Count current JSON files
CURRENT_COUNT=$(find "$ALEX_DIR" "$PROJECT_DIR" \
    -path "*/node_modules" -prune -o \
    -path "*/.git" -prune -o \
    -path "*/chromadb" -prune -o \
    -name "package-lock.json" -prune -o \
    -name "*.json" -print 2>/dev/null | wc -l)

# Track previous count for change detection
PREV_COUNT=0
[ -f "$PREVIOUS" ] && PREV_COUNT=$(cat "$PREVIOUS")
echo "$CURRENT_COUNT" > "$PREVIOUS"

DIFF=$((CURRENT_COUNT - PREV_COUNT))
if [ "$PREV_COUNT" -gt 0 ] && [ "$DIFF" -gt 0 ]; then
    CHANGE_NOTE="(+${DIFF} since last scan)"
elif [ "$PREV_COUNT" -gt 0 ] && [ "$DIFF" -lt 0 ]; then
    CHANGE_NOTE="(${DIFF} since last scan)"
else
    CHANGE_NOTE=""
fi

# Generate the report
cat > "$OUTPUT" <<HEADER
================================================================================
  ALEX JSON FILE INDEX
  Auto-generated: $(date '+%A %d %B %Y, %H:%M:%S')
  Total JSON files: ${CURRENT_COUNT} ${CHANGE_NOTE}
================================================================================

This file is automatically updated every 30 minutes.
Run manually: bash Alex-Scripts/update-json-index.sh

HEADER

# --- Section 1: Project JSON files ---
{
echo "────────────────────────────────────────────────────────────────────────"
echo "  PROJECT FILES (navada-1/)"
echo "────────────────────────────────────────────────────────────────────────"
echo ""
printf "  %-50s  %8s  %s\n" "FILE" "SIZE" "LAST MODIFIED"
printf "  %-50s  %8s  %s\n" "────" "────" "─────────────"

find "$PROJECT_DIR" \
    -path "*/node_modules" -prune -o \
    -path "*/.git" -prune -o \
    -path "*/chromadb" -prune -o \
    -path "*/.alex" -prune -o \
    -name "package-lock.json" -prune -o \
    -name "*.json" -print 2>/dev/null | sort | while read -r f; do
    REL="${f#$PROJECT_DIR/}"
    SIZE=$(stat -c%s "$f" 2>/dev/null || echo 0)
    MOD=$(stat -c '%Y' "$f" 2>/dev/null | xargs -I{} date -d @{} '+%Y-%m-%d %H:%M' 2>/dev/null || echo "unknown")
    if [ "$SIZE" -ge 1048576 ]; then
        HUMAN_SIZE="$(echo "scale=1; $SIZE/1048576" | bc)M"
    elif [ "$SIZE" -ge 1024 ]; then
        HUMAN_SIZE="$(echo "scale=1; $SIZE/1024" | bc)K"
    else
        HUMAN_SIZE="${SIZE}B"
    fi
    printf "  %-50s  %8s  %s\n" "$REL" "$HUMAN_SIZE" "$MOD"
done
echo ""
} >> "$OUTPUT"

# --- Section 2: Conversations ---
{
echo "────────────────────────────────────────────────────────────────────────"
echo "  CONVERSATIONS (~/.alex/conversations/)"
echo "────────────────────────────────────────────────────────────────────────"
echo ""

ACTIVE=$(find "$ALEX_DIR/conversations" -maxdepth 1 -name "*.json" 2>/dev/null | wc -l)
ARCHIVED=$(find "$ALEX_DIR/conversations/archive" -name "*.json" 2>/dev/null | wc -l)
echo "  Active: ${ACTIVE}  |  Archived: ${ARCHIVED}"
echo ""
printf "  %-50s  %8s  %s\n" "FILE" "SIZE" "LAST MODIFIED"
printf "  %-50s  %8s  %s\n" "────" "────" "─────────────"

find "$ALEX_DIR/conversations" -maxdepth 1 -name "*.json" 2>/dev/null | sort | while read -r f; do
    NAME=$(basename "$f")
    SIZE=$(stat -c%s "$f" 2>/dev/null || echo 0)
    MOD=$(stat -c '%Y' "$f" 2>/dev/null | xargs -I{} date -d @{} '+%Y-%m-%d %H:%M' 2>/dev/null || echo "unknown")
    if [ "$SIZE" -ge 1024 ]; then
        HUMAN_SIZE="$(echo "scale=1; $SIZE/1024" | bc)K"
    else
        HUMAN_SIZE="${SIZE}B"
    fi
    printf "  %-50s  %8s  %s\n" "$NAME" "$HUMAN_SIZE" "$MOD"
done
echo ""
} >> "$OUTPUT"

# --- Section 3: Tasks ---
{
echo "────────────────────────────────────────────────────────────────────────"
echo "  SCHEDULED TASKS (~/.alex/tasks/)"
echo "────────────────────────────────────────────────────────────────────────"
echo ""
printf "  %-40s  %-20s  %s\n" "TASK" "SCHEDULE" "STATUS"
printf "  %-40s  %-20s  %s\n" "────" "────────" "──────"

find "$ALEX_DIR/tasks" -name "*.json" 2>/dev/null | sort | while read -r f; do
    NAME=$(python3 -c "import json,sys; d=json.load(open('$f')); print(d.get('name','?'))" 2>/dev/null || basename "$f" .json)
    CRON=$(python3 -c "import json,sys; d=json.load(open('$f')); print(d.get('cron_expression','?'))" 2>/dev/null || echo "?")
    ENABLED=$(python3 -c "import json,sys; d=json.load(open('$f')); print('enabled' if d.get('enabled',True) else 'disabled')" 2>/dev/null || echo "?")
    printf "  %-40s  %-20s  %s\n" "$NAME" "$CRON" "$ENABLED"
done
echo ""
} >> "$OUTPUT"

# --- Section 4: Cache ---
{
echo "────────────────────────────────────────────────────────────────────────"
echo "  CONTENT CACHE (~/.alex/cache/content/)"
echo "────────────────────────────────────────────────────────────────────────"
echo ""
CACHE_COUNT=$(find "$ALEX_DIR/cache/content" -name "*.json" 2>/dev/null | wc -l)
CACHE_SIZE=$(du -sh "$ALEX_DIR/cache/content" 2>/dev/null | cut -f1 || echo "0")
echo "  Files: ${CACHE_COUNT}  |  Total size: ${CACHE_SIZE}"
echo "  (Auto-cleaned: 3-day TTL, 50-entry cap)"
echo ""
} >> "$OUTPUT"

# --- Section 5: Inbox ---
{
echo "────────────────────────────────────────────────────────────────────────"
echo "  INBOX & EMAIL (~/.alex/inbox/)"
echo "────────────────────────────────────────────────────────────────────────"
echo ""

find "$ALEX_DIR/inbox" -name "*.json" 2>/dev/null | sort | while read -r f; do
    REL="${f#$ALEX_DIR/}"
    SIZE=$(stat -c%s "$f" 2>/dev/null || echo 0)
    if [ "$SIZE" -ge 1024 ]; then
        HUMAN_SIZE="$(echo "scale=1; $SIZE/1024" | bc)K"
    else
        HUMAN_SIZE="${SIZE}B"
    fi
    printf "  %-50s  %s\n" "$REL" "$HUMAN_SIZE"
done

find "$ALEX_DIR/email_groups" -name "*.json" 2>/dev/null | sort | while read -r f; do
    REL="${f#$ALEX_DIR/}"
    SIZE=$(stat -c%s "$f" 2>/dev/null || echo 0)
    printf "  %-50s  %sB\n" "$REL" "$SIZE"
done
echo ""
} >> "$OUTPUT"

# --- Section 6: Other ---
{
echo "────────────────────────────────────────────────────────────────────────"
echo "  OTHER FILES"
echo "────────────────────────────────────────────────────────────────────────"
echo ""
printf "  %-50s  %8s  %s\n" "FILE" "SIZE" "PURPOSE"
printf "  %-50s  %8s  %s\n" "────" "────" "───────"

# Datasets
if [ -d "$ALEX_DIR/datasets" ]; then
    find "$ALEX_DIR/datasets" -name "*.json" 2>/dev/null | while read -r f; do
        NAME=$(basename "$f")
        SIZE=$(stat -c%s "$f" 2>/dev/null || echo 0)
        HUMAN_SIZE="$(echo "scale=1; $SIZE/1024" | bc)K"
        printf "  %-50s  %8s  %s\n" "datasets/$NAME" "$HUMAN_SIZE" "Reference data"
    done
fi

# Terminal queue
[ -f "$ALEX_DIR/terminal-queue.json" ] && {
    SIZE=$(stat -c%s "$ALEX_DIR/terminal-queue.json" 2>/dev/null || echo 0)
    printf "  %-50s  %8sB  %s\n" "terminal-queue.json" "$SIZE" "Heartbeat msgs for desktop terminal"
}

# Logs
find "$ALEX_DIR/logs" -name "*.json" 2>/dev/null | while read -r f; do
    NAME="logs/$(basename "$f")"
    SIZE=$(stat -c%s "$f" 2>/dev/null || echo 0)
    printf "  %-50s  %8sB  %s\n" "$NAME" "$SIZE" "Processed message tracking"
done

echo ""
} >> "$OUTPUT"

# --- Footer ---
cat >> "$OUTPUT" <<FOOTER
================================================================================
  END OF INDEX
  Next auto-update: $(date -d '+30 minutes' '+%H:%M' 2>/dev/null || echo "~30 min")
================================================================================
FOOTER

echo "[JSON-INDEX] Updated: $OUTPUT (${CURRENT_COUNT} files)"
