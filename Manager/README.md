# ALEX Manager

Audit, reporting, and backup tools for ALEX. Run everything from:

```
cd ~/ALEX_NAVADA/Manager
```

---

## Quick Reference

| Command | What it does |
|---------|-------------|
| `python3 view-conversations.py view --html` | Full visual HTML report |
| `python3 view-conversations.py list-chats` | List all chat IDs |
| `python3 daily-summary.py generate` | Today's daily summary |
| `bash backup.sh` | Backup Pi + send to iPhone |
| `bash "Alex System Scan/system-scan.sh"` | Full system health & security scan |
| `cat sessions/SESSION-LOG.md` | View all dev session plans |

---

## 1. HTML Reports — `view-conversations.py`

All reports save to `reports/{date}/` with timestamps so nothing gets overwritten.

### Full Report (all conversations, all time)

```bash
python3 view-conversations.py view --html
```

### Single Telegram User

```bash
python3 view-conversations.py view 6920669447 --html
```

### Single Channel

```bash
python3 view-conversations.py view terminal-chat --html
python3 view-conversations.py view control-api --html
python3 view-conversations.py view slack-C0AC5MK54DU --html
```

### Search Keyword Across All Conversations

```bash
python3 view-conversations.py view --search "market" --html
python3 view-conversations.py view --search "LinkedIn" --html
python3 view-conversations.py view --search "email" --html
```

### Search Within a Specific User

```bash
python3 view-conversations.py view 6920669447 --search "stock" --html
```

### Report Contents

Each HTML report includes:
- Stats bar (total messages, conversations, date range, active channels)
- Bar chart: messages per day
- Pie chart: messages by channel (Telegram, Slack, Terminal, etc.)
- Bar chart: top 10 most active chat IDs
- Full conversation table with date, time, chat ID, channel, message count, and first user message

Reports open automatically in the browser. Find them later in:

```
Manager/reports/
  2026-02-06/
    conversations-1555.html
    conversations-1555-6920669447.html
    conversations-1555-search-market.html
  2026-02-07/
    ...
```

---

## 2. Terminal Audit — `view-conversations.py`

Text-based output for quick checks without a browser.

### List All Chat IDs with Message Counts

```bash
python3 view-conversations.py list-chats
```

### View All Conversations (pipe to less)

```bash
python3 view-conversations.py view | less
```

### View One User's Full History

```bash
python3 view-conversations.py view 6920669447 | less
```

### Last N Messages Per Conversation

```bash
python3 view-conversations.py view --last 5
python3 view-conversations.py view 6920669447 --last 10
```

### Search Keyword (Terminal)

```bash
python3 view-conversations.py view --search "hello"
python3 view-conversations.py view 6920669447 --search "stock"
```

### Summary Only (No Message Content)

```bash
python3 view-conversations.py view --summary
```

### Combine Filters

```bash
python3 view-conversations.py view 6920669447 --search "market" --last 5
```

---

## 3. Daily Summaries — `daily-summary.py`

Generates markdown summaries of each day's conversations. Saved to `~/ALEX_NAVADA/daily/{Mon}-{Year}/`.

### Generate Today's Summary

```bash
python3 daily-summary.py generate
```

### Generate for a Specific Date

```bash
python3 daily-summary.py generate --date 2026-02-04
```

### Regenerate Today (overwrite)

```bash
python3 daily-summary.py generate --force
```

### Backfill All Days (Jan 31 to today)

```bash
python3 daily-summary.py backfill
```

### Backfill a Date Range

```bash
python3 daily-summary.py backfill --from 2026-02-01 --to 2026-02-04
```

### View a Daily Summary

```bash
cat ~/ALEX_NAVADA/daily/Feb-2026/Friday-06-Feb-2026.md
```

---

## 4. Backups — `backup.sh`

Two copies: local on Pi + iPhone via Tailscale. Keeps last 8 backups, auto-rotates old ones.

### Run Full Backup (Pi + iPhone)

```bash
bash backup.sh
```

### Pi Only

```bash
bash backup.sh --local
```

### iPhone Only (sends latest backup)

```bash
bash backup.sh --iphone
```

### What Gets Backed Up

- `navada-1/` (ALEX source, excludes node_modules)
- `~/.alex/` (config, conversations, memory, tasks)
- `~/ALEX_NAVADA/` (Manager tools, daily summaries, reports)
- `~/alex-terminal/` (desktop terminal app)
- `~/.env` (API keys)

### Backup Schedule (automatic)

| When | What |
|------|------|
| Daily 4am | Local Pi backup |
| Sunday 3am | Local + iPhone via Tailscale |

### Backup Location

```
/home/head/backups/
  alex-backup-2026-02-06.tar.gz
  alex-backup-2026-02-05.tar.gz
  backup.log
```

### Accept on iPhone

Open **Tailscale app > Files** on your iPhone to accept incoming backups.

---

## 5. Session Log — `sessions/SESSION-LOG.md`

Record of everything built on ALEX during Claude Code sessions since Day 1 (31 Jan 2026). Auto-updates on every git commit to `navada-1/`.

### View Session History

```bash
cat sessions/SESSION-LOG.md | less
```

---

## 6. Search for Specific Words — Terminal Commands

Search any word across all ALEX conversations and generate a visual HTML report:

```bash
python3 view-conversations.py view --search "market" --html
python3 view-conversations.py view --search "stock" --html
python3 view-conversations.py view --search "LinkedIn" --html
python3 view-conversations.py view --search "Kerry" --html
python3 view-conversations.py view --search "email" --html
```

Narrow search to one user:

```bash
python3 view-conversations.py view 6920669447 --search "stock" --html
```

Search without HTML (terminal only, scroll with space, quit with q):

```bash
python3 view-conversations.py view --search "market" | less
python3 view-conversations.py view 6920669447 --search "stock" | less
```

---

## 7. Admin Dashboards

Web dashboards for managing ALEX's cloud services. Password: `Navadaonline2026!`

| Service | URL | What it manages |
|---------|-----|-----------------|
| **Upstash Redis** | https://console.upstash.com | Dashboard data, token costs, commits, contacts, API keys |
| **ChromaDB Cloud** | https://cloud.trychroma.com | RAG knowledge base (document embeddings for ALEX) |
| **Vercel** | https://vercel.com/dashboard | alexnavada.xyz deployments, serverless functions, domains |

### View Redis data from terminal

```bash
# Local Redis (on Pi)
redis-cli KEYS '*'
redis-cli GET dash:data | python3 -m json.tool

# Upstash Redis (cloud)
curl -s "https://relevant-lobster-61446.upstash.io/keys/*" \
  -H "Authorization: Bearer AfAGAAIncDE5ZWIyNmZmYzlhNzI0Y2E2YWI4ODk4ZGE0Mzg0OTFlYnAxNjE0NDY" | python3 -m json.tool
```

### Key Redis keys

| Key | Contents |
|-----|----------|
| `dash:data` | Dashboard activity, tasks, news, services |
| `dash:tokens` | Today's token usage and costs |
| `dash:commits` | Git commit history |
| `dash:inbox` | Email inbox data |
| `contacts:index` | Registered contacts |
| `apikeys:index` | API keys list |

---

## 8. System Scan — `Alex System Scan/system-scan.sh`

Full project health, security, and state audit. Checks git status, services, disk, secrets, permissions, dependencies, backups, and more. Each run saves a timestamped report.

### Run Full Scan

```bash
bash "Alex System Scan/system-scan.sh"
```

### Quick Scan (skip security checks)

```bash
bash "Alex System Scan/system-scan.sh" --quick
```

### View Previous Scan Reports

```bash
ls "Alex System Scan"/scan-*.txt
cat "Alex System Scan"/scan-2026-02-06-1830.txt
```

### What It Checks

| Section | Checks |
|---------|--------|
| **Project Overview** | Size, file counts, lines of code, dependencies, Node/Python versions |
| **Git Status** | Branch, commits ahead/behind, unstaged changes, untracked files, tokens in remote URL |
| **Services** | systemd services (alex, navada-1, navada, navada-iphone), stale/rogue services |
| **Disk & System** | Disk usage, memory, CPU temp, uptime, load average |
| **Security Audit** | .env permissions, hardcoded secrets, command injection, CORS, auth bypass, gitignore, git history, dependencies, logging |
| **Dashboard** | Vercel API endpoint count, config |
| **Workspace** | ~/.alex/ conversations, memory, tasks, skills, config |
| **Backups** | Latest backup age, count, size |

### Report Storage

Reports auto-save to `Alex System Scan/` with timestamp. Keeps last 20, rotates old ones.

```
Alex System Scan/
├── system-scan.sh               ← the scanner
├── scan-2026-02-06-1830.txt     ← saved reports
├── scan-2026-02-07-0900.txt
└── ...
```

---

## Folder Structure

```
Manager/
├── README.md                  ← this file
├── view-conversations.py      ← audit + HTML reports
├── daily-summary.py           ← daily markdown summaries
├── backup.sh                  ← Pi + iPhone backups
├── Alex System Scan/          ← system health & security scanner
│   ├── system-scan.sh         ← run this
│   └── scan-*.txt             ← saved reports (auto-rotated)
├── reports/                   ← generated HTML reports (by date)
│   └── 2026-02-06/
│       ├── conversations-1555.html
│       └── conversations-1555-6920669447.html
└── sessions/
    ├── SESSION-LOG.md          ← dev session plans (auto-updating)
    └── update-session-log.sh   ← git hook helper
```
