# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ALEX is an autonomous AI economist agent running 24/7 on a Raspberry Pi 5 for NAVADA. It operates via Telegram, performs economic research, generates reports, sends emails, and maintains a live dashboard. ES modules throughout (`"type": "module"`), Node.js 22+.

## Commands

```bash
npm start              # Start ALEX (node src/gateway.js)
npm run dev            # Dev mode with auto-reload (node --watch)
node --check src/*.js  # Syntax check all source files
sudo systemctl restart alex  # Restart the live service
sudo systemctl status alex   # Check service status
```

No test suite exists. Verify changes with `node --check` on modified files.

## Architecture

### Message Flow

```
Telegram message → gateway.js (dedup + auth)
  → downloads photos/docs as base64 content blocks
  → chat.js chat() → selectModel() routes to Haiku/Sonnet/DeepSeek/GPT-4o
  → buildSystemPrompt() includes identity, memory, RAG context, uploaded files list
  → prepareMessages() summarizes old messages, keeps last 8 verbatim
  → callAnthropicQueued() via queue.js (priority queue with circuit breaker)
  → processResponse() loops on tool_use blocks
    → tools.js executeTool() with dependency injection
  → smartSplit() response at paragraph boundaries → send via Telegram
```

### Key Modules

- **gateway.js** — Entry point. Telegram bot setup, control API (port 9090), tool execution wrapper with dependency injection (`execToolWithDeps`), `heartbeatDeps()` factory for scheduled task context.
- **chat.js** — `createChatSystem()` returns `{ chat, processResponse, callAnthropicQueued, buildSystemPrompt }`. Model selection via regex pattern matching. Token logging to `~/.alex/logs/tokens_*.jsonl`. Conversation summarization with Haiku to keep context compact.
- **tools.js** — `TOOLS` array (tool definitions for Claude) and `executeTool()` switch. Tools get deps via object destructuring: `{ memory, skills, config, scheduledTasks, handleScheduledTask, openaiClient }`. Delete guardrail blocks `rm`/`rmdir`/`unlink`/`shred` in `bash` tool — requires `confirm_delete` tool with 3 user confirmations + password.
- **slack.js** — `setupSlack(deps)` and `startSlackPolling()`. Polls channel + DMs via Slack Web API every 3s. Mention-only in channels, always responds in DMs. Threaded replies in channels, direct replies in DMs. Each thread gets its own conversation context.
- **heartbeat.js** — `BUILTIN_TASKS` map of task definitions. `handleScheduledTask()` runs a task through the AI. `runDashboardSync()` for hourly metrics. `runCleanup()` for conversation pruning. No scheduling logic — system cron handles that.
- **memory.js** — `MemorySystem` class. Conversations stored per chat ID with rolling summaries. Categories: user, projects, research, tasks, knowledge. Identity from `IDENTITY.md`, user info from `USER.md`.
- **skills.js** — `SkillsSystem` class. Skills stored as `~/.alex/skills/{name}/SKILL.md`. Skill names injected into system prompt.
- **config.js** — Loads `~/.alex/config.json`. Exports `WORKSPACE_PATH` (`~/.alex`), `ALLOWED_WRITE_PATHS`, `ALLOWED_ATTACHMENT_PATHS`, `isPathAllowed()`.

### Control API (port 9090)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/command` | Run a message through the chat system |
| `POST /api/send` | Direct message to a Telegram user |
| `POST /api/trigger` | Trigger a scheduled task by name (used by system cron) |
| `GET /api/users` | List known Telegram users |
| `POST /api/broadcast` | Message all known users |

### Scheduling

System cron (`/etc/cron.d/alex`) calls `POST /api/trigger` with `{"task":"name"}`. The trigger endpoint checks `BUILTIN_TASKS` map first, then `~/.alex/tasks/{name}.json` on disk. Special cases: `dashboard-sync` and `cleanup` bypass the AI.

User-created tasks via `schedule_task` tool write both a JSON file and a cron line to `/etc/cron.d/alex-tasks`.

### Model Routing (selectModel in chat.js)

1. Explicit overrides: "use haiku", "use deepseek", "use gpt" etc.
2. DeepSeek patterns: "deep research", "thorough analysis"
3. Haiku for short simple messages (<80 chars): greetings, status checks
4. Sonnet (default): research, analysis, reports, email, tools

### Dashboard

Fire-and-forget POSTs to `http://127.0.0.1:8080/api/update`. Dashboard server is a separate Python process at `/home/head/clawd/dashboard/server.py`. Actions: `add_task`, `add_activity`, `add_news`, `update_metrics`, `update_services`, `set_status`.

## Workspace Layout

```
~/.alex/
├── config.json          # API keys (mode 0600)
├── IDENTITY.md          # ALEX personality/role definition
├── USER.md              # User information
├── KNOWLEDGE.md         # Accumulated knowledge
├── uploads/             # Files received via Taildrop
├── conversations/       # Per-chat JSON with messages + summary
├── memory/              # Categorized memory files (user, projects, research, tasks)
├── skills/              # Skill definitions (SKILL.md per skill)
├── tasks/               # Scheduled task JSON definitions
├── templates/           # Email templates (signature.html, daily-summary.html, etc.)
├── logs/                # Audit, token, and cron logs
├── reports/             # Generated PDFs
├── charts/              # Generated charts/visualizations
└── images/              # Generated images (DALL-E)
```

## Important Patterns

- **Dependency injection**: `executeTool` receives all deps as a single object — never imports globals directly. When adding tools, add any new deps to `execToolWithDeps` in gateway.js.
- **Multimodal content**: `chat()` accepts either a string or an array of Claude content blocks (text/image/document). The `selectModel` and `buildSystemPrompt` functions extract text from arrays via the `userText` variable.
- **Token conservation**: System prompt includes skill names only (not full definitions), RAG top-3 chunks, rolling conversation summaries, and last 8 messages verbatim.
- **Queue priority**: User messages = priority 10, scheduled tasks = priority 1. Higher number = processed first.
- **Email signature**: Uses publicly hosted images (freeimage.host) for Gmail compatibility. Both template and non-template paths must be updated when changing the signature.
- **Alpha Vantage**: Financial data tools (stock_quote, stock_search, company_overview, market_news, crypto_rate, economic_indicator) use the Alpha Vantage REST API. API key stored in config as `alphavantage_api_key`. Helper function `alphaVantageQuery()` in tools.js handles all API calls. `/stocks` Telegram command provides a quick quote shortcut.

## Cron Job Reliability

Scheduled tasks use system cron (`/etc/cron.d/alex` and `/etc/cron.d/alex-tasks`) calling ALEX's `/api/trigger` endpoint. Three layers of resilience ensure tasks don't get lost:

### 1. Curl retry (immediate)
All cron entries use `curl --retry 3 --retry-delay 30 --retry-connrefused`. If ALEX is briefly restarting, curl retries 3 times at 30-second intervals (~90s window).

### 2. Startup catch-up (on recovery)
`catchUpMissedTasks()` in gateway.js runs on startup. It compares the current time against `~/.alex/logs/.last-alive` (written every 60s while running). Any built-in heartbeat tasks whose scheduled hour falls in the gap are automatically fired with 5s stagger.

### 3. systemd restart (service level)
The `alex.service` unit has `Restart=always` and `RestartSec=5`, so Node crashes auto-recover within seconds.

### Operational notes
- Cron logs: `~/.alex/logs/cron.log`
- Alive marker: `~/.alex/logs/.last-alive`
- To manually fire a missed task: `curl -X POST http://127.0.0.1:9090/api/trigger -H 'Content-Type: application/json' -d '{"task":"task-name"}'`
- After editing cron files in `cron/`, copy to `/etc/cron.d/`: `sudo cp cron/alex /etc/cron.d/alex && sudo cp cron/alex-tasks /etc/cron.d/alex-tasks`
- Cron files MUST have a trailing newline and be owned by root (`sudo chown root:root /etc/cron.d/alex*`)
