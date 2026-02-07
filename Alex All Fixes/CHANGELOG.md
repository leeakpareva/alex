# ALEX — Changelog

All improvements, bug fixes, and features since ALEX was born.

---

## 2026-02-06 — `f3e1d76` Add Manager toolkit, Ralph self-improvement, backup system, and audit reports
**Type:** Feature | **Areas:** Gateway, Heartbeat, Manager, Scripts, Tests
- Add Manager toolkit, Ralph self-improvement, backup system, and audit reports (19 file(s) changed)

## 2026-02-02 — generate_webapp Tool + /fixes Command
**Type:** Feature
- Added `generate_webapp` tool — generates self-contained HTML web apps (dashboards, calculators, interactive reports) and sends as Telegram file attachments
- Added `/fixes` command — displays last 5 changelog entries in Telegram
- Updated `/alex` and `/help` menus with new commands

## 2026-02-02 — `a1e398c` Directory Reorg, Email Menu & New Commands
**Type:** Feature + Improvement
- Reorganised `~/.alex/` directory structure (outputs/, files/, logs/audit/, logs/tokens/)
- Added `/email` interactive inline button menu for full email management
- Added `/architecture` command — project and workspace structure overview
- Added `/logs` command — recent audit log entries
- Added `/disk` command — disk usage breakdown
- Added `/cleanup` command — manual cleanup of old files and conversations
- Added `/errors` command — today's errors from audit log
- Added `/health` command — quick system health overview
- Added logrotate config for gateway.log, cron.log, dashboard.log
- Added directory migration script (`deploy/migrate-dirs.sh`)

## 2026-02-02 — `696be7c` 25 Improvements: Security, Reliability, Smart Routing
**Type:** Feature + Bug Fix + Security
- Rate limiting on control API (30 req/min)
- Bash command hardening (blocklist for rm, shred, etc.)
- CORS restriction and body size limits
- Tool execution timeouts
- Circuit breakers for DeepSeek and OpenAI fallback
- Graceful shutdown with queue draining
- Health endpoint (`/api/health`)
- Smart model routing — Sonnet auto-selects for complex tasks, Haiku for simple
- Keyword index for memory recall fallback
- Conversation archiving after 100 messages
- User preference extraction and auto-reminders
- Auto-fact extraction from conversations
- Stock price alerts and deadline follow-ups
- Enhanced morning briefing digest
- Idle conversation starters (owner only, business hours)
- Tool execution and error audit logging
- 96 unit tests across 6 test files

## 2026-02-02 — `476ebc6` Manage User Tool + Process Fix
**Type:** Bug Fix + Feature
- **Fix:** Added `KillMode=control-group` to systemd service — old Node processes were surviving restarts, causing duplicate bot polling
- Added `manage_user` tool for owner to add/remove/list Telegram users via chat
- Full-access user grants take effect immediately without restart

## 2026-02-01 — `843b53f` Executive Summary Email Trigger
**Type:** Feature
- `EXEC_SUMMARY` keyword in Telegram/API sends NAVADA Executive Summary PDF to specified recipient
- Professional intro email template from Lee Akpareva

## 2026-02-01 — `5f404b5` Token Attribution + Cost Savings
**Type:** Feature + Improvement
- Per-task token attribution in logs (chatId, source, taskName)
- `/costs` command — cost breakdown by source and task name
- **Changed default model from Sonnet to Haiku** — major cost reduction
- Sonnet now opt-in only via "use sonnet" or `/models`
- Scheduled heartbeat tasks also use Haiku
- Improved system prompt: natural responses, no command dumps on greetings

## 2026-02-01 — `c6e2668` CLAUDE.md Rewrite + Public Chart Tools
**Type:** Improvement
- CLAUDE.md rewritten as comprehensive expert reference with line-number landmarks
- `generate_chart`, `generate_diagram`, `generate_mindmap` made public (removed from OWNER_ONLY_TOOLS)

## 2026-02-01 — `3ab9318` Haiku Token Fix + Tiered Auth + Diagram Tools
**Type:** Bug Fix + Feature + Security
- **Fix:** Haiku max_tokens set to 8192 (was 16384, causing API 400 errors)
- Replaced hard auth block with tiered access — limited users can chat and use basic commands
- Added `generate_diagram` tool (Mermaid → PNG)
- Added `generate_mindmap` tool (Markmap → PNG via Puppeteer)

## 2026-02-01 — `f827b13` Task Tracking + /tracked Command
**Type:** Feature + Fix
- **Fix:** Stopped logging every user message as a dashboard task (was flooding the dashboard)
- CAPITAL keyword detection (TASK, APPOINTMENT, MEETING, DEADLINE, etc.) for intentional task tracking
- `/tracked` command to view last 20 tracked tasks

## 2026-02-01 — `6312692` README Rewrite
**Type:** Docs
- README rewritten as production-grade documentation
- Security model, performance tracking, 25+ commands documented

## 2026-02-01 — `a213b7e` Full Tool Lockdown
**Type:** Security
- All filesystem, shell, email, and system tools locked to owner-only
- Non-owner users limited to web_lookup, memory_recall, web_search

## 2026-02-01 — `20e816c` Sensitive Info Masking
**Type:** Security
- `maskSensitive()` redacts API keys, tokens, passwords from tool outputs
- Removed port, PID, workspace path from `/status` output

## 2026-02-01 — `9880c6d` Auth, Rate Limiting, /testreport
**Type:** Security + Feature
- Bearer token auth on Control API
- Rate limiting (30 req/min)
- OWNER_ONLY_TOOLS permission system
- `/testreport` command for system health reports
- Reverted '/' from ALLOWED_WRITE_PATHS

## 2026-02-01 — `b0203e5` Remove Limits + fetch_url
**Type:** Feature + Improvement
- `fetch_url` tool (GET/POST/PUT/PATCH/DELETE with headers and body)
- Increased max_tokens to 16384, bash timeout to 300s, Python timeout to 180s
- Increased read_file limits (500K text, 200K PDF)
- "use opus" model override

## 2026-02-01 — `b717b39` Markdown Crash Fix
**Type:** Bug Fix
- **Fix:** `/start` and `/alex` commands crashed Telegram due to Markdown parsing of underscores and brackets
- Switched to HTML parse mode for these commands

## 2026-02-01 — `6850034` Financial Tools, Slack, Email Filing, Tests
**Type:** Feature
- Alpha Vantage integration: stock_quote, stock_search, company_overview, market_news, crypto_rate, economic_indicator
- `/stocks` Telegram command
- Slack bot with channel polling, DM support, threaded replies
- Email filing system with AI triage, `/inbox`, `/email`, `/action` commands
- Vitest test suite

## 2026-02-01 — `40a39c2` Voice Emails + /exit + Wallet Tracking
**Type:** Feature
- Voice note detection in emails → TTS MP3 attachments in replies
- `/exit` command to leave educational mode
- `/spend` now shows Anthropic wallet balance, runway estimate

## 2026-02-01 — `b0dd866` Gmail Inbox + CLI + /learn Mode
**Type:** Feature
- Gmail IMAP polling (every 2 min) with AI-powered replies
- `bin/alex` CLI wrapper for terminal access
- `/learn` educational mode (What/How/Why structure)
- Improved all `/` commands with richer output

## 2026-01-31 — `6908dd1` Dashboard
**Type:** Feature
- Local Python dashboard server (port 8080)
- Vercel serverless frontend with Upstash Redis sync
- Token cost tracking, git commits, UK economy page

## 2026-01-31 — `039c372` Voice Messages + Multimodal
**Type:** Feature
- Voice notes saved with Whisper transcription
- Photo/document/PDF understanding via multimodal content blocks
- `send_voice_message` tool for TTS responses

## 2026-01-31 — `9ffd954` Cron Resilience + PDF Fix
**Type:** Bug Fix + Improvement
- Cron entries now retry 3 times with 30s delay on failure
- Startup catch-up fires missed tasks after downtime
- Alive marker written every 60s for downtime detection
- **Fix:** PDF generator now handles bullets, bold, sub-headings properly

## 2026-01-31 — `5716fd3` System Cron + Multimodal + NAVADA Rebrand
**Type:** Feature + Improvement
- Migrated from node-cron to system cron (`/etc/cron.d/alex`)
- POST `/api/trigger` endpoint for cron-driven tasks
- Telegram photo/document/PDF understanding
- Taildrop auto-receive watcher
- Rebrand from "NAVADA VC" to "NAVADA"
- New ALEX synthwave email signature

## 2026-01-31 — `e0fb7f8` Model Overrides + Check-ins
**Type:** Feature
- Explicit model selection: "use haiku", "use deepseek", "use gpt", "use sonnet"
- GPT-4o direct routing (was fallback only)
- DeepSeek response sanitisation (strip leaked tool_use JSON)
- 3 daily proactive check-in messages

## 2026-01-31 — `76da9ae` Dashboard Activity Logging
**Type:** Feature
- Auto-post user messages and Alex responses to dashboard activity feed

## 2026-01-31 — `30afdf8` ALEX v1.0 — Born
**Type:** Initial Release
- Gateway, chat system (sliding window + DeepSeek routing)
- 31 tools (email, charts, bash, files, web, scheduling)
- Heartbeat system, memory, config, queue, skills
- Running on Raspberry Pi 5

---

*Updated on every push to GitHub.*
