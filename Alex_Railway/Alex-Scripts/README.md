# Alex-Scripts

All utility and operational scripts for ALEX, consolidated in one place.

## Runtime Scripts (called by ALEX's Node.js code)

| Script | Called by | Purpose |
|--------|-----------|---------|
| `rag_manager.py` | `document-processor.js`, `tools.js`, `heartbeat.js`, `daily-journal.js` | ChromaDB bridge: index-text, query, cleanup, stats |
| `taildrop-watcher.sh` | Runs as companion process | Watches for Tailscale file drops, triggers document processing via control API |
| `send-email.mjs` | CLI / standalone | Send emails via Gmail using ALEX's config |

## Backup Scripts

| Script | Schedule | Purpose |
|--------|----------|---------|
| `alex-backup.sh` | Daily 4am (cron) | Backup `~/.alex/` with 7-day rotation, optional Tailscale remote push |
| `manager-backup.sh` | Daily 4am + Weekly Sunday 3am (cron) | Manager-level backup (local + remote) |

## Management & Analysis Scripts

| Script | Purpose |
|--------|---------|
| `system-scan.sh` | Full system health + security audit (produces timestamped reports) |
| `daily-summary.py` | Generate daily activity summaries |
| `view-conversations.py` | Browse and inspect ALEX conversation JSON files |
| `ons_dashboard.py` | ONS (Office for National Statistics) dashboard data |

## Dashboard & Deployment

| Script | Purpose |
|--------|---------|
| `push_to_vercel.sh` | Push dashboard data to Vercel |
| `update-changelog.sh` | Update the fixes changelog |
| `update-claude-log.sh` | Regenerate `Leslie_Work_with_Claude.md` from plan files |
| `update-session-log.sh` | Update the session log markdown |

## Running Scripts Manually

All scripts can be run from terminal. First `cd` into the project:

```bash
cd /home/head/navada-1
```

### System & Security

```bash
# Full system health + security scan (saves report to Alex-Scripts/)
bash Alex-Scripts/system-scan.sh
```

### Backups

```bash
# Run daily backup manually
bash Alex-Scripts/alex-backup.sh

# Run daily backup with remote Tailscale push
bash Alex-Scripts/alex-backup.sh --remote

# Run manager backup (local only)
bash Alex-Scripts/manager-backup.sh --local

# Run manager backup (full — local + remote)
bash Alex-Scripts/manager-backup.sh
```

### ChromaDB / RAG

```bash
# Search the knowledge base
python3 Alex-Scripts/rag_manager.py query "search terms here"

# See how many chunks are indexed, by source
python3 Alex-Scripts/rag_manager.py stats

# Remove expired entries
python3 Alex-Scripts/rag_manager.py cleanup

# Index text from a file (reads from stdin)
cat /path/to/file.txt | python3 Alex-Scripts/rag_manager.py index-text --source "my-doc" --ttl 7

# Index permanent text (never expires)
cat /path/to/file.txt | python3 Alex-Scripts/rag_manager.py index-text --source "my-doc" --permanent
```

### Email

```bash
# Send a plain text email
node Alex-Scripts/send-email.mjs --to "email@example.com" --subject "Subject" --body "Hello world"

# Send an HTML email from a file
node Alex-Scripts/send-email.mjs --to "email@example.com" --subject "Report" --body-file /path/to/body.html

# Send with attachment
node Alex-Scripts/send-email.mjs --to "email@example.com" --subject "Report" --body "See attached" --attachment /path/to/file.pdf
```

### Conversations & Logs

```bash
# Browse ALEX's conversation files interactively
python3 Alex-Scripts/view-conversations.py

# Generate a daily summary
python3 Alex-Scripts/daily-summary.py

# Update the session log
bash Alex-Scripts/update-session-log.sh

# Regenerate Claude work log from plan files
bash Alex-Scripts/update-claude-log.sh

# Update the fixes changelog
bash Alex-Scripts/update-changelog.sh
```

### Dashboard

```bash
# Push dashboard data to Vercel
bash Alex-Scripts/push_to_vercel.sh

# Run ONS dashboard data script
python3 Alex-Scripts/ons_dashboard.py
```

### Taildrop Watcher

```bash
# Start watching for Tailscale file drops (runs in foreground, Ctrl+C to stop)
bash Alex-Scripts/taildrop-watcher.sh
```
