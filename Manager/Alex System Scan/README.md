# Alex System Scan

Full health, security, and state audit for the ALEX project. Run from:

```
cd ~/ALEX_NAVADA/Manager
```

---

## Run Full Scan

```bash
bash "Alex System Scan/system-scan.sh"
```

## Quick Scan (skip security checks)

```bash
bash "Alex System Scan/system-scan.sh" --quick
```

---

## What It Checks

| # | Section | Checks |
|---|---------|--------|
| 1 | **Project Overview** | Size, file counts, lines of code, dependencies, Node/Python versions |
| 2 | **Git Status** | Branch, ahead/behind, unstaged changes, untracked files, tokens in remote URL |
| 3 | **Services** | systemd services (alex, navada-1, navada, navada-iphone), stale/rogue services, cron jobs |
| 4 | **Disk & System** | Disk usage, memory, CPU temp, uptime, load average |
| 5 | **Security Audit** | .env permissions, hardcoded secrets, command injection, CORS, auth bypass, gitignore, git history, dependencies, logging |
| 6 | **Dashboard** | Vercel API endpoint count, vercel.json config |
| 7 | **Workspace** | ~/.alex/ conversations, memory, tasks, skills, config |
| 8 | **Backups** | Latest backup age, count, size |

---

## Severity Levels

| Level | Meaning |
|-------|---------|
| **CRIT** | Must fix — security risk or broken functionality |
| **WARN** | Should review — potential issue or improvement needed |
| **OK** | Passed — no action needed |
| **INFO** | Context — not a check, just information |

---

## View Previous Reports

```bash
ls "Alex System Scan"/scan-*.txt
cat "Alex System Scan"/scan-2026-02-06-1808.txt
```

Reports auto-rotate — keeps the last 20 scans.

---

## Folder Structure

```
Alex System Scan/
├── README.md                    ← this file
├── system-scan.sh               ← the scanner
├── scan-2026-02-06-1808.txt     ← saved reports (timestamped)
└── ...
```
