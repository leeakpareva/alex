#!/bin/bash

# Setup Alex cron schedule on Railway deployment
# This script configures all scheduled tasks for Alex

echo "🕐 Setting up Alex scheduled tasks..."

# Create the cron configuration
cat > /etc/cron.d/alex << 'EOF'
# ALEX Scheduled Tasks - Complete Daily Schedule
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
ALEX_PORT=9090

# === MORNING ROUTINE ===
# 7am - Refresh API data
0 7 * * *    root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"api-data-refresh"}' >> /app/.alex/logs/cron.log 2>&1

# 8am - Morning briefing
0 8 * * *    root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"morning-briefing"}' >> /app/.alex/logs/cron.log 2>&1

# 9am - Check follow-ups and deadlines
0 9 * * *    root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"check-followups"}' >> /app/.alex/logs/cron.log 2>&1

# 9am - Stock alerts (weekdays)
0 9 * * 1-5  root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"stock-alerts"}' >> /app/.alex/logs/cron.log 2>&1

# 10am - Inbox review
0 10 * * *   root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"inbox-review"}' >> /app/.alex/logs/cron.log 2>&1

# === MIDDAY ROUTINE ===
# 11am - Mid-morning check-in
0 11 * * *   root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"midmorning-checkin"}' >> /app/.alex/logs/cron.log 2>&1

# 12pm - Stock alerts (weekdays)
0 12 * * 1-5 root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"stock-alerts"}' >> /app/.alex/logs/cron.log 2>&1

# 1pm - Midday research
0 13 * * *   root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"midday-research"}' >> /app/.alex/logs/cron.log 2>&1

# === AFTERNOON/EVENING ROUTINE ===
# 3pm - Inbox review (second check)
0 15 * * *   root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"inbox-review"}' >> /app/.alex/logs/cron.log 2>&1

# 4pm - Afternoon check-in
0 16 * * *   root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"afternoon-checkin"}' >> /app/.alex/logs/cron.log 2>&1

# 4pm - Stock market close alerts (weekdays)
0 16 * * 1-5 root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"stock-alerts"}' >> /app/.alex/logs/cron.log 2>&1

# 6pm - Evening summary
0 18 * * *   root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"evening-summary"}' >> /app/.alex/logs/cron.log 2>&1

# === NIGHTLY ROUTINE ===
# 9pm - Ralph self-improvement review
0 21 * * *   root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"ralph-review"}' >> /app/.alex/logs/cron.log 2>&1

# 10pm - Daily ops report email to Lee
0 22 * * *   root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"daily-ops-report"}' >> /app/.alex/logs/cron.log 2>&1

# 10pm Sunday - Weekly self-review
0 22 * * 0   root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"weekly-self-review"}' >> /app/.alex/logs/cron.log 2>&1

# === MAINTENANCE TASKS ===
# 2am - Daily journal churn
0 2 * * *    root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"daily-churn"}' >> /app/.alex/logs/cron.log 2>&1

# 3am - Cleanup old conversations & logs
0 3 * * *    root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"cleanup"}' >> /app/.alex/logs/cron.log 2>&1

# === HOURLY TASKS ===
# Every hour - Dashboard sync
0 * * * *    root    curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://localhost:${ALEX_PORT}/api/trigger -H 'Content-Type: application/json' -d '{"task":"dashboard-sync"}' >> /app/.alex/logs/cron.log 2>&1

# === MONITORING ===
# Every 5 minutes - Keep-alive marker for catch-up mechanism
*/5 * * * *  root    echo "$(date -Iseconds)" > /app/.alex/logs/.last-alive

EOF

# Set proper permissions
chmod 644 /etc/cron.d/alex

# Restart cron service
service cron restart || systemctl restart cron || /etc/init.d/cron restart

echo "✅ Alex scheduled tasks configured successfully"
echo ""
echo "📋 Daily Schedule:"
echo "  7:00 AM  - API data refresh"
echo "  8:00 AM  - Morning briefing"
echo "  9:00 AM  - Check follow-ups & stock alerts"
echo "  10:00 AM - Inbox review"
echo "  11:00 AM - Mid-morning check-in"
echo "  12:00 PM - Stock alerts (weekdays)"
echo "  1:00 PM  - Midday research"
echo "  3:00 PM  - Inbox review"
echo "  4:00 PM  - Afternoon check-in & stock alerts"
echo "  6:00 PM  - Evening summary"
echo "  9:00 PM  - Ralph self-improvement"
echo "  10:00 PM - Daily ops report"
echo "  2:00 AM  - Daily journal processing"
echo "  3:00 AM  - Cleanup"
echo "  Hourly   - Dashboard sync"
echo ""
echo "Use 'crontab -l' to verify the schedule"