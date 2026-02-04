# CLAUDE.md — ALEX Agent Expert Reference

> Comprehensive guide for Claude Code working on this codebase. ES modules throughout (`"type": "module"`), Node.js 22+, Raspberry Pi 5.

## Commands

```bash
npm start                        # node src/gateway.js
npm run dev                      # node --watch src/gateway.js
node --check src/*.js            # Syntax-check all source files
sudo systemctl restart alex      # Restart live service
sudo systemctl status alex       # Check service status
```

Test suite: `npx vitest run` (unit + e2e). Also verify with `node --check` on modified files.

## Owner ID

**Only Telegram user `6920669447` has full access.** All other users are limited — see [Tiered Auth](#tiered-auth-system) below.

---

## Architecture Overview

```
Telegram message → gateway.js:271 setupTelegram() (dedup + auth)
  → downloads photos/docs as base64 content blocks
  → chat.js:659 chat() → :203 selectModel() routes to Haiku/Sonnet/DeepSeek/GPT-4o
  → :495 buildSystemPrompt() — identity, memory, RAG context, uploads list
  → :399 prepareMessages() — summarises older messages, keeps last 12 verbatim
  → :345 callAnthropicQueued() via queue.js (priority queue + circuit breaker)
  → :593 processResponse() loops on tool_use blocks
    → tools.js:618 executeTool() with dependency injection
  → :748 smartSplit() at paragraph boundaries → send via Telegram
```

---

## File-by-File Guide

| File | Lines | Purpose | Key landmarks |
|------|------:|---------|---------------|
| **gateway.js** | 2491 | Entry point: Telegram bot, control API (port 9090), dep injection | `execToolWithDeps` :136, `heartbeatDeps` :159, `setupTelegram` :271, `setupControlAPI` :1975, `catchUpMissedTasks` :2300, `init` :2377 |
| **chat.js** | 779 | Chat system factory, model routing, summarisation, API calls | `selectModel` :203, `CircuitBreaker` :247, `createChatSystem` :280, `callAnthropicWithRetry` :284, `summarizeOlderMessages` :366, `prepareMessages` :399, `buildSystemPrompt` :495, `processResponse` :593, `chat` :659, `smartSplit` :748 |
| **tools.js** | 1612 | 32 tool definitions + `executeTool` switch | `TOOLS[]` :173–755, `OWNER_ONLY_TOOLS` :785, `executeTool` :817, `bash` :833, `generate_chart` :1151, `generate_diagram` :1435, `generate_mindmap` :1453, `tiktok_scrape` :1601 |
| **queue.js** | 67 | Priority request queue with 429 cooldown | `enqueue` :16, `_process` :27 |
| **heartbeat.js** | 235 | Built-in scheduled tasks, dashboard sync, cleanup | `BUILTIN_TASKS` :21, `handleScheduledTask` :90, `runDashboardSync` :133, `runCleanup` :222 |
| **memory.js** | 215 | Conversations, categorised memory, knowledge base | `MemorySystem.init` :57, `saveConversation` :131, `cleanupOldConversations` :194 |
| **skills.js** | 226 | Skill CRUD, 7 default skills | Skills stored as `~/.alex/skills/{name}/SKILL.md` |
| **config.js** | 89 | Config loader, path validation | `WORKSPACE_PATH`, `ALLOWED_WRITE_PATHS`, `isPathAllowed()` |
| **keyword-index.js** | 100 | Inverted keyword index with TF scoring for memory_recall fallback | `KeywordIndex`, `search`, `addDocument` |
| **alerts.js** | 60 | Stock/service alert threshold monitoring | `AlertsSystem`, `getAlerts`, `wasRecentlyFired` |
| **slack.js** | 326 | Slack Web API polling (3s), threaded replies | `setupSlack` + `startSlackPolling` |
| **inbox.js** | 543 | Gmail inbox monitoring, AI replies | Email filing integration |
| **email-filing.js** | 412 | Email filing/categorisation system | — |

---

## Tiered Auth System

**Owner (user `6920669447`):** Full access to all 32 tools and all Telegram commands.

**Limited users:** Access only to safe, conversational tools. Everything that touches the Pi filesystem, shell, email, scheduling, or costs money is blocked.

### OWNER_ONLY_TOOLS — `tools.js:610`

```
bash, read_file, write_file, edit_file, list_directory, grep, glob,
send_email, schedule_task, delete_task, confirm_delete, fetch_url,
generate_pdf, generate_image, create_skill,
send_file, send_voice_message, update_dashboard, memory_save,
tiktok_scrape
```

### Public tools (all users)

```
web_lookup, web_search, memory_recall,
stock_quote, stock_search, company_overview, market_news, crypto_rate, economic_indicator,
get_recent_uploads,
generate_chart, generate_diagram, generate_mindmap
```

Chart/diagram/mindmap tools are public — they produce PNG images sent via Telegram with no filesystem or shell risk. `generate_image` (DALL-E) and `generate_pdf` remain owner-only due to cost/risk.

### Permission check — `tools.js`

```javascript
if (OWNER_ONLY_TOOLS.has(name) && config.telegram_owner_id && callerUserId) {
    if (callerUserId !== config.telegram_owner_id && !FULL_ACCESS_USERS.has(callerUserId)) {
        return { success: false, error: `Permission denied: '${name}' is restricted to the account owner.` };
    }
}
```

The `callerUserId` is passed through the dependency injection chain from `gateway.js:136 execToolWithDeps`.

---

## Tool System

### Definition & Execution

Tools are defined in `TOOLS[]` array (`tools.js:144–586`) as Claude tool-use JSON schemas. Executed via a giant switch in `executeTool()` (`tools.js:618`).

### Dependency Injection

`executeTool` receives all deps as a single destructured object:
```javascript
{ memory, skills, config, scheduledTasks, handleScheduledTask, openaiClient, bot, callerUserId }
```

Never import globals directly. When adding tools, add new deps to `execToolWithDeps` in `gateway.js:136`.

### Delete Guardrail — `tools.js:631`

The `bash` tool blocks `rm`, `rmdir`, `unlink`, `shred` commands. Deletion requires the `confirm_delete` tool with 3 sequential user confirmations + a password.

### Output Masking — `tools.js:595`

`maskSensitive()` strips API keys, tokens, and secrets from all tool output before returning to the model.

---

## Model Routing — `chat.js:203 selectModel()`

Priority order:

1. **Explicit override** (:207–212): "use haiku" / "use deepseek" / "use gpt" / "use sonnet" / "use opus"
2. **DeepSeek patterns** (:215–220): "deep research", "deep dive", "thorough analysis", "detailed research" → `deepseek-chat`
3. **Haiku for short simple messages** (:223–230): < 80 chars, greetings, acks, slash commands → `claude-3-5-haiku-20241022`
4. **Sonnet for complex tasks** (:233–238): research, analysis, report, email, tools keywords → `claude-sonnet-4-20250514`
5. **Default** (:240): `claude-sonnet-4-20250514`

### max_tokens by model

| Model | max_tokens | Where set |
|-------|-----------|-----------|
| Haiku | 8192 | `chat.js:631`, `:724` |
| Sonnet | 16384 | `chat.js:631`, `:724` |
| DeepSeek | 8192 | `chat.js:479` |
| GPT-4o | 8192 | `chat.js:328` |
| Summary (Haiku) | 800 | `chat.js` |

---

## Conversation Summarisation — `chat.js:366`

### Constants
- `RECENT_WINDOW = 8` — last 8 messages kept verbatim

### Two-tier approach

1. **Sliding window** (`prepareMessages` :399): If ≤ 12 messages, send all. Otherwise split into older + recent 12.
2. **Incremental summary** (`summarizeOlderMessages` :366): Older messages summarised via Haiku (priority 0, 400-word limit). If prior summary exists, new messages are merged into it.

### Message structure sent to API

```
[system prompt]
{ role: 'user', content: '[Earlier conversation summary: ...]' }
{ role: 'assistant', content: 'Understood, I have the context...' }
...last 12 messages verbatim...
```

Storage: `~/.alex/conversations/{chatId}.json` — last 100 messages + rolling summary.

---

## Smart Splitting — `chat.js:748`

Splits long responses (> 4000 chars) for Telegram delivery:

1. Find last `\n\n` (paragraph break) in first 4000 chars, but not before 30% mark
2. Fallback: last `\n` (line break) not before 30% mark
3. Last resort: hard cut at 4000

---

## Circuit Breaker & Queue

### Circuit Breaker — `chat.js:247`

- **Threshold:** 5 failures → circuit opens for 5 minutes
- `recordSuccess()` resets counter to 0
- When open, calls fail immediately (triggers OpenAI GPT-4o fallback)

### Priority Queue — `queue.js:16`

- User messages: priority 10 (processed first)
- Scheduled tasks: priority 1
- On HTTP 429: 60-second cooldown, request re-queued (`queue.js:54`)

### Retry + Fallback — `chat.js:284`

`callAnthropicWithRetry`: up to 5 retries with exponential backoff for 429/529 errors. After all retries exhausted → falls back to OpenAI GPT-4o (`:313–342`).

---

## Cron / Heartbeat System

### Flow

System cron (`/etc/cron.d/alex`) → `curl POST /api/trigger {"task":"name"}` → `gateway.js setupControlAPI` → checks `BUILTIN_TASKS` map (`heartbeat.js:21`) → `handleScheduledTask` runs task through AI.

Special bypass: `dashboard-sync` → `runDashboardSync()` (:133), `cleanup` → `runCleanup()` (:222).

User tasks: `schedule_task` tool writes JSON to `~/.alex/tasks/` + cron line to `/etc/cron.d/alex-tasks`.

### Three layers of resilience

1. **Curl retry**: `--retry 3 --retry-delay 30 --retry-connrefused` (~90s window)
2. **Startup catch-up** (`gateway.js:2300`): Compares current time vs `~/.alex/logs/.last-alive` (written every 60s). Missed tasks auto-fired with 5s stagger.
3. **systemd**: `Restart=always`, `RestartSec=5`

---

## Control API — port 9090 (`gateway.js:1975`)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/command` | Run a message through the chat system |
| `POST /api/send` | Direct message to a Telegram user |
| `POST /api/trigger` | Trigger a scheduled task by name |
| `GET /api/users` | List known Telegram users |
| `POST /api/broadcast` | Message all known users |

---

## Dashboard

Fire-and-forget POSTs to `http://127.0.0.1:8080/api/update`. Dashboard server: `dashboard/server.py` (separate Python process). Also pushes to Redis for Vercel frontend (`gateway.js:102 scheduleDashPush`).

Actions: `add_task`, `add_activity`, `add_news`, `update_metrics`, `update_services`, `set_status`.

---

## Workspace Layout

```
~/.alex/
├── config.json          # API keys (mode 0600)
├── IDENTITY.md          # ALEX personality/role definition
├── USER.md              # User information
├── KNOWLEDGE.md         # Accumulated knowledge
├── uploads/             # Files received via Taildrop
├── conversations/       # Per-chat JSON with messages + summary
├── memory/              # Categorized memory (user, projects, research, tasks)
├── skills/              # Skill definitions (SKILL.md per skill)
├── tasks/               # Scheduled task JSON definitions
├── templates/           # Email templates (signature.html, daily-summary.html, etc.)
├── logs/                # Audit, token, and cron logs
├── reports/             # Generated PDFs
├── charts/              # Generated charts/visualisations
├── diagrams/            # Mermaid diagrams
├── mindmaps/            # Markmap mind maps
└── images/              # Generated images (DALL-E)
```

---

## Key Patterns

- **Dependency injection**: `executeTool` receives all deps as a single object — never import globals. Add new deps to `execToolWithDeps` in `gateway.js:136`.
- **Multimodal content**: `chat()` accepts string or array of Claude content blocks (text/image/document). `selectModel` and `buildSystemPrompt` extract text via the `userText` variable.
- **Token conservation**: System prompt includes skill names only (not full definitions), RAG top-3 chunks, rolling conversation summaries, last 12 messages verbatim.
- **Queue priority**: User messages = 10, scheduled tasks = 1. Higher = processed first.
- **Email signature**: Uses publicly hosted images (freeimage.host). Both template and non-template paths must be updated when changing signature.
- **Alpha Vantage**: Financial tools use `alphaVantageQuery()` helper (`tools.js:158`). API key in config as `alphavantage_api_key`.
- **Apify**: TikTok scraper uses `apifyRunActor()` helper (`tools.js:173`). API key in config as `apify_api_key`. Uses `clockworks~tiktok-scraper` actor.

---

## Chart/Diagram/Mindmap Tools (Public)

### generate_chart — `tools.js:926`

Full Python environment (numpy, pandas, matplotlib, seaborn, plotly, altair, scipy, scikit-learn). Injects `output_path` variable. 180s timeout. Returns PNG with `send_photo: true` or text-only output.

### generate_diagram — `tools.js:1156`

Mermaid diagrams via `npx @mermaid-js/mermaid-cli mmdc`. Supports flowcharts, sequence, class, state, ER, Gantt, pie. 60s timeout. Output to `~/.alex/diagrams/`.

### generate_mindmap — `tools.js:1174`

Markmap via `npx markmap-cli` + Puppeteer screenshot. Accepts markdown outline, renders to HTML, screenshots to PNG at 1400x1000. 60s timeout. Output to `~/.alex/mindmaps/`.

---

## Recent Changes

| Commit | Change |
|--------|--------|
| `3ab9318` | Fix Haiku max_tokens (8192), add tiered auth, add Mermaid/Markmap diagram tools |
| `a213b7e` | Lock down all Pi-access tools to owner-only |
| `20e816c` | Mask sensitive info in tool outputs |
| `9880c6d` | API auth, rate limiting, owner-only tool permissions |
| `6850034` | Alpha Vantage financial tools, Slack integration, email filing |
| Latest | Allow chart/diagram/mindmap tools for all users (removed from OWNER_ONLY_TOOLS) |
| Latest | 25 improvements: rate limiting, CORS hardening, tool timeouts, health endpoint, prompt caching, bash blocklist, tool output truncation, RECENT_WINDOW=8, keyword index, conversation archiving, auto-fact extraction, user prefs, RAG fallback, enhanced briefing, deadline follow-ups, stock alerts, idle starters, auto-reminders, circuit breakers for DeepSeek/OpenAI, graceful shutdown, test suite |
| Latest | TikTok scraper (`tiktok_scrape` tool + `/tiktok` command) via Apify API |

---

## Known Constraints & Improvement Areas

- **Test suite** — vitest unit + e2e tests available via `npx vitest run`
- **Single-process** — no clustering; one stuck tool blocks the queue
- **Conversation storage** — flat JSON files, no database; 100-message cap per chat
- **RAG** — depends on ChromaDB being available; degrades gracefully if down (`tools.js:22 checkRAG`)
- **Puppeteer for mindmaps** — heavy for a Pi 5; may OOM on complex maps
- **DeepSeek/OpenAI fallback** — now have circuit breakers (added in improvements)
- **Cron file ownership** — must be `root:root` with trailing newline or cron silently ignores them
