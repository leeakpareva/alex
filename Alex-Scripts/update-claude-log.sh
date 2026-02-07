#!/usr/bin/env bash
# update-claude-log.sh — Regenerate Leslie_Work_with_Claude.md from ~/.claude/plans/
# Usage: bash scripts/update-claude-log.sh  (or alias: update-claude-log)

set -euo pipefail

PLANS_DIR="$HOME/.claude/plans"
LOG_FILE="$(dirname "$0")/../Leslie_Work_with_Claude.md"

if [ ! -d "$PLANS_DIR" ]; then
    echo "No plans directory found at $PLANS_DIR"
    exit 1
fi

echo "Scanning $PLANS_DIR..."
echo ""

# List all plan files with dates
for f in "$PLANS_DIR"/*.md; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    date=$(stat -c '%Y' "$f" 2>/dev/null | xargs -I{} date -d @{} '+%Y-%m-%d' 2>/dev/null || date -r "$f" '+%Y-%m-%d')
    title=$(head -1 "$f" | sed 's/^#\s*//')
    echo "| $date | \`$name\` | $title |"
done | sort

echo ""
echo "Log file: $LOG_FILE"
echo "Note: Manual review recommended — auto-scan shows dates and titles only."
echo "Edit $LOG_FILE to update the full table."
