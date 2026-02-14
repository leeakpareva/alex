#!/bin/bash
# Pushes dashboard data to Vercel KV every 30s
# Called by cron: two entries per minute (0s and 30s)

# Log rotation: keep last 100 lines
LOG="/tmp/vercel-push.log"
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 200 ]; then
  tail -100 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

VERCEL_URL="${VERCEL_PUSH_URL:-https://dashboard-vercel-kohl.vercel.app}"
SECRET="${VERCEL_PUSH_SECRET:-navada-push-2026}"

DATA=$(curl -sf http://127.0.0.1:8080/dashboard_data.json)
TOKENS=$(curl -sf http://127.0.0.1:8080/api/tokens)
COMMITS=$(curl -sf http://127.0.0.1:8080/api/commits)

# Only push if we got data
if [ -n "$DATA" ]; then
  curl -sf -X POST "$VERCEL_URL/api/push" \
    -H "Authorization: Bearer $SECRET" \
    -H "Content-Type: application/json" \
    -d "{\"dashboard\":$DATA,\"tokens\":$TOKENS,\"commits\":$COMMITS}"
fi
