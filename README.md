# NAVADA AI Agent Framework

A production-grade autonomous AI agent that runs 24/7 on a Raspberry Pi 5. Built as **ALEX**, the Global Economist at NAVADA — a real employee that researches markets, sends emails, generates reports, monitors inboxes, and manages its own schedule. Designed to be cloned and re-personalised into any AI agent role.

**Live:** [www.alexnavada.xyz](https://www.alexnavada.xyz)

---

## Why This Exists

Most AI agents are demos. ALEX is a deployed, measurable team member running in production since January 2026. Every action is logged, every token is costed, every task is tracked on a live dashboard. You can see exactly what the agent did, when, and how much it cost — in real time.

The framework solves the hard problems of running an AI agent 24/7: conversation memory that doesn't blow up context windows, graceful API failures, cron job resilience across reboots, multi-model routing to control costs, and a security model that lets external users interact without exposing the host.

---

## Capabilities

| Capability | Description |
|------------|-------------|
| **Research** | Web search, market analysis, real-time financial data (stocks, crypto, economic indicators) |
| **Email** | Draft and send HTML emails with attachments, branded templates, auto-CC |
| **Gmail Inbox** | IMAP polling every 2 min — AI triage, auto-replies, Telegram notifications with action summaries |
| **Email Filing** | AI-powered email categorisation, priority scoring, and status tracking |
| **PDF Reports** | Styled PDF reports with tables, charts, and NAVADA branding |
| **Data Analysis** | Python execution with numpy, pandas, matplotlib, seaborn, scipy, scikit-learn |
| **Charts** | Generate and send data visualisations directly in Telegram |
| **Diagrams** | Mermaid diagram rendering (flowcharts, sequence, ER, Gantt, pie, etc.) to PNG |
| **Mind Maps** | Markmap mind map generation from markdown outlines to PNG |
| **Web Apps** | Generate self-contained interactive HTML apps (dashboards, calculators, data tables) via `generate_webapp` |
| **Voice** | Receive voice notes (Whisper transcription) and send voice responses (TTS) |
| **URL Fetching** | Hit any API, scrape any page, download data via `fetch_url` |
| **Scheduling** | Cron-based tasks, reminders, recurring jobs — 8+ daily heartbeats by default |
| **Memory** | Persistent memory across all conversations with rolling summaries and auto-fact extraction |
| **Skills** | Self-extending plugin system — the agent can create its own tools |
| **RAG** | ChromaDB vector search over knowledge base with keyword fallback |
| **Dashboard** | Live Vercel dashboard with real-time task tracking, token costs, activity log |
| **Multi-Platform** | Telegram + Slack + CLI + Control API |
| **Smart Routing** | Haiku for greetings, Sonnet for work, Opus on demand, DeepSeek for deep research, GPT-4o fallback |
| **Modes** | `/learn` (educational), `/mathematician` (quantitative), `/strategist` (frameworks), `/python` (data), `/voice` (audio) |
| **User Management** | Add/remove Telegram users and grant/revoke full access via `manage_user` tool |

---

## Security Model

The agent enforces a two-tier permission system at both the **command** and **tool** level.

### Owner (full access)

All 31+ tools available including bash, file operations, email, code execution, scheduling, diagrams, mind maps, web apps, and system management. All 40 Telegram commands available.

### Limited Users (chat + basic commands)

Limited users can chat with the agent and use a subset of commands. Owner-only tools are blocked at the API level.

| Allowed Commands | Allowed Tools | Blocked |
|-----------------|---------------|---------|
| `/start`, `/help` | `web_lookup` — search the web | `bash` — shell commands |
| `/stocks`, `/news` | `web_search` — Claude web search | `read_file` / `write_file` / `edit_file` — filesystem |
| `/research`, `/brief` | `memory_recall` — read knowledge | `send_email`, `fetch_url`, `generate_pdf`, `generate_webapp` |
| `/tracked` | `stock_quote`, `stock_search` — financial data | `generate_image`, `schedule_task`, `delete_task` |
| | `generate_chart`, `generate_diagram`, `generate_mindmap` | `send_file`, `send_voice_message`, `manage_user` |
| | | All other system commands |

### Additional Protections

- **Sensitive data masking**: API keys, tokens, passwords, and secrets are automatically redacted in all tool outputs before reaching the model
- **Control API authentication**: Bearer token required for all non-cron API requests
- **Rate limiting**: 30 requests/minute per IP on the Control API
- **CORS hardening**: Restricted origins and body size limits
- **Delete guardrail**: File deletions require 3 confirmations + password
- **Bash blocklist**: Dangerous commands (`mkfs`, `dd`, `reboot`, `shutdown`, `systemctl stop alex`, `chmod 777 /`, pipe-to-shell) blocked at execution
- **Tool timeouts**: Per-tool timeout limits (bash 300s, chart 180s, diagram/mindmap 60s, default 30s)
- **Circuit breakers**: Automatic API call suspension after 5 consecutive failures for Anthropic, DeepSeek, and OpenAI — auto-recovers after 5 minutes
- **Tool output truncation**: Large tool outputs capped to prevent token blowout

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Agent Gateway                         │
│                      (src/gateway.js)                        │
├──────────┬──────────┬──────────┬──────────┬────────────────┤
│ Telegram │  Slack   │  Gmail   │  Skills  │    Request     │
│   Bot    │   Bot    │  Inbox   │  System  │     Queue      │
├──────────┴──────────┴──────────┴──────────┴────────────────┤
│  Claude (Sonnet 4 / Haiku 3.5 / Opus 4.5 / DeepSeek)      │
│  OpenAI (Whisper STT / TTS / DALL-E) + Web Search + Tools  │
├────────────────────┬───────────────────────────────────────┤
│  ChromaDB (RAG)    │  Python (analysis) + reportlab (PDF)  │
├────────────────────┴───────────────────────────────────────┤
│                    Raspberry Pi 5 (8GB)                      │
│     24/7 systemd + cron scheduling + auto-recovery          │
├─────────────────────────────────────────────────────────────┤
│         Dashboard: Upstash Redis → Vercel (live)            │
└─────────────────────────────────────────────────────────────┘
```

### Message Flow

```
Telegram/Slack message → gateway.js (dedup + auth + permission tier)
  → downloads photos/docs/voice as content blocks
  → voice notes: Whisper transcription → text
  → natural acknowledgment from 14 varied responses (no robotic "Let me check")
  → chat.js chat() → selectModel() routes to optimal model
  → buildSystemPrompt() with identity, memory, RAG context
  → prepareMessages() summarizes old messages, keeps last 8 verbatim
  → callAnthropicQueued() via priority queue + circuit breaker
  → processResponse() loops on tool_use blocks (12-msg window for scheduled tasks)
  → smartSplit() response at paragraph boundaries → send via Telegram/Slack
```

### Model Routing

| Trigger | Model | Cost/Call |
|---------|-------|-----------|
| Greetings, status checks, short messages (<80 chars) | Haiku 3.5 (8192 max tokens) | ~$0.002 |
| Research, analysis, reports, emails, tools, building | Sonnet 4 (16384 max tokens) | ~$0.10 |
| Scheduled tasks (morning briefing, inbox review, etc.) | Sonnet 4 | ~$0.10 |
| "use deepseek", deep research, thorough analysis | DeepSeek | ~$0.001 |
| "use gpt", explicit GPT request | GPT-4o | ~$0.05 |
| "use opus", maximum capability | Opus 4.5 | ~$0.30 |

### Source Modules

| Module | Purpose |
|--------|---------|
| `src/gateway.js` | Entry point. Telegram/Slack bots, authenticated control API, tool execution with dependency injection, permission enforcement, startup catch-up for missed tasks, 40 Telegram commands |
| `src/chat.js` | Chat system factory. Model selection, token logging, conversation summarisation, API calls with retry and fallback, auto-fact extraction, auto-reminder detection |
| `src/tools.js` | 31+ tool definitions + `executeTool()` switch. Owner-only permission enforcement, sensitive data masking, delete guardrail, tool timeouts |
| `src/heartbeat.js` | Built-in task definitions, scheduled task execution through AI (Sonnet), dashboard sync, cleanup. HTML notifications with plain-text fallback |
| `src/memory.js` | Persistent memory system. Per-chat conversations with rolling summaries, categorised memory, RAG integration, conversation archiving |
| `src/skills.js` | Self-extending skill system. Skills stored as `~/.alex/skills/{name}/SKILL.md` |
| `src/slack.js` | Slack interface. Channel polling + DMs, threaded replies, mention-only filtering |
| `src/inbox.js` | Gmail inbox monitor. IMAP polling, AI reply generation, Telegram notifications |
| `src/email-filing.js` | Email filing and categorisation with AI triage, priority scoring, status management |
| `src/config.js` | Config loader with validation, path security |
| `src/queue.js` | Priority request queue with circuit breaker and rate limit handling |
| `src/keyword-index.js` | Inverted keyword index with TF scoring for memory recall fallback |
| `src/alerts.js` | Stock and service alert threshold monitoring |

---

## Performance Tracking

Everything the agent does is measured in real time:

- **Token usage** — per-call logging by model with source attribution (telegram, scheduled, api)
- **Task completion** — every task logged to the dashboard with status, category, token count, and cost
- **Activity log** — timestamped record of every action, visible on the live dashboard
- **Cost breakdown** — `/tokens` for today, `/spend` for lifetime, `/costs` for per-task attribution, `/projection` for forecasts
- **Heartbeat monitoring** — 8+ daily scheduled tasks with success/failure tracking
- **Session metrics** — uptime, API calls, conversations tracked, all visible via `/status`
- **Auto-fact extraction** — key facts automatically saved to knowledge base every 20 messages

### Cost to Run

Based on real production data (Jan-Feb 2026):

| Component | Daily | Monthly | Annual |
|-----------|-------|---------|--------|
| API tokens (Claude + OpenAI) | ~£8 | ~£244 | ~£2,964 |
| Raspberry Pi electricity (12W) | £0.07 | £2.15 | £25.75 |
| **Total** | **~£8** | **~£246** | **~£2,990** |

For comparison, a human doing the same job costs ~£50,000/year (UK mid-level + employer NI/pension/overhead). The agent delivers **94% cost savings** and works 24/7.

---

## Telegram Commands (40)

All commands are registered in Telegram's `/` autocomplete menu in alphabetical order.

| Command | Description |
|---------|-------------|
| `/action <n> <action>` | Act on a triaged email (reply, forward, archive, etc.) |
| `/alex` | Full command reference (compact) |
| `/architecture` | Project and workspace structure overview |
| `/brief` | Recent activity summary this session |
| `/cleanup` | Manual cleanup of old files and stale conversations |
| `/clear` | Clear conversation history (keeps long-term memory) |
| `/costs` | Per-task cost attribution breakdown |
| `/dashboard` | Live dashboard link |
| `/disk` | Disk usage breakdown of ~/.alex/ |
| `/duties` | All cron duties, schedules, next runs, performance |
| `/email <n>` | Full email details for email #n |
| `/errors` | Today's errors from audit log |
| `/exit` | Turn off all active modes |
| `/fixes` | Recent changelog entries (last 5 from Fixes/CHANGELOG.md) |
| `/health` | Quick system health overview |
| `/help` | Full guide with tips and mode descriptions |
| `/id` | Your Telegram user and chat ID |
| `/inbox` | Email queue (not_started by default). Supports: `clear`, `done all`, `delete`, `mark` |
| `/learn` | Toggle educational mode (What / How / Why structure) |
| `/logs` | Recent audit log entries |
| `/mathematician` | Toggle quantitative mode (calculations, financial models, statistics) |
| `/memory` | Browse memory banks |
| `/mode` | Show active modes |
| `/models` | Switch AI model or restore auto-routing |
| `/news` | Latest gathered news and insights |
| `/profile` | ALEX personal details, DOB, owner info |
| `/projection` | Cost projection and ROI analysis |
| `/python` | Toggle Python mode (forces Python execution for all analysis) |
| `/research <topic>` | Deep research on any topic (runs in background) |
| `/skills` | List custom skills |
| `/spend` | Lifetime cost report with daily breakdown |
| `/start` | Welcome message |
| `/status` | System health — hardware, services, costs, session metrics |
| `/stocks <symbol>` | Quick stock quote (Alpha Vantage) |
| `/strategist` | Toggle strategic mode (SWOT, Porter's, PESTLE frameworks) |
| `/tasks` | List scheduled and recurring tasks |
| `/testreport` | Full system test report (health, tools, connectivity) |
| `/tokens` | Today's API usage by model |
| `/tracked` | View tracked tasks (use CAPITAL keywords to track: TASK, MEETING, DEADLINE, etc.) |
| `/voice` | Toggle voice reply mode (TTS responses) |

Modes can be stacked: `/mathematician` + `/strategist` gives quantitative strategic analysis.

---

## Tools (31+)

| Tool | Access | Description |
|------|--------|-------------|
| `bash` | Owner | Execute shell commands (with blocklist for dangerous ops) |
| `read_file` | Owner | Read any file on the Pi |
| `write_file` | Owner | Write files anywhere under /home/head |
| `edit_file` | Owner | Precise text replacement in files |
| `list_directory` | Owner | Browse filesystem |
| `grep` | Owner | Regex search across files |
| `glob` | Owner | Find files by name pattern |
| `web_lookup` | All | DuckDuckGo web search |
| `web_search` | All | Claude built-in web search |
| `memory_save` | Owner | Save to persistent memory |
| `memory_recall` | All | Read from persistent memory |
| `send_email` | Owner | HTML emails with templates and attachments |
| `generate_pdf` | Owner | Professional PDF reports |
| `generate_chart` | All | Python data analysis and visualisation |
| `generate_diagram` | All | Mermaid diagrams to PNG |
| `generate_mindmap` | All | Markmap mind maps to PNG |
| `generate_webapp` | Owner | Self-contained interactive HTML web apps |
| `generate_image` | Owner | DALL-E 3 image generation |
| `schedule_task` | Owner | Create cron-based scheduled tasks |
| `delete_task` | Owner | Remove scheduled tasks |
| `create_skill` | Owner | Create new agent skills |
| `update_dashboard` | Owner | Push data to live dashboard |
| `send_file` | Owner | Send any file via Telegram |
| `send_voice_message` | Owner | Text-to-speech voice messages |
| `fetch_url` | Owner | HTTP requests (GET/POST/PUT/PATCH/DELETE) |
| `stock_quote` | All | Real-time stock prices (Alpha Vantage) |
| `stock_search` | All | Search stock ticker symbols |
| `company_overview` | All | Company fundamentals and financials |
| `market_news` | All | Market news with sentiment analysis |
| `crypto_rate` | All | Cryptocurrency exchange rates |
| `economic_indicator` | All | US economic data (GDP, CPI, unemployment, etc.) |
| `confirm_delete` | Owner | Execute file deletion after 3 confirmations + password |
| `manage_user` | Owner | Add/remove Telegram users, grant/revoke full access |
| `get_recent_uploads` | All | List recently uploaded files in chat |

---

## Workspace Layout

```
~/.alex/
├── config.json              # API keys (mode 0600)
├── IDENTITY.md              # Agent personality/role definition
├── USER.md                  # User information
├── KNOWLEDGE.md             # Accumulated knowledge base
├── conversations/           # Per-chat JSON with messages + rolling summary
├── memory/                  # Categorised memory (user, projects, research, tasks, knowledge)
├── skills/                  # Skill definitions (SKILL.md per skill)
├── tasks/                   # Scheduled task JSON definitions
├── templates/               # Email templates (signature.html, daily-summary.html, etc.)
├── files/
│   └── uploads/             # Files received via Telegram or Taildrop
├── outputs/
│   ├── reports/             # Generated PDFs
│   ├── charts/              # Generated charts/visualisations
│   ├── diagrams/            # Mermaid diagrams
│   ├── mindmaps/            # Markmap mind maps
│   ├── images/              # DALL-E generated images
│   └── webapps/             # Generated HTML web applications
├── logs/
│   ├── audit/               # Tool execution and error audit logs
│   └── tokens/              # Per-day token usage JSONL files
└── voice/                   # Voice notes and transcriptions
```

---

## Setup Guide

### 1. Clone and Install

```bash
git clone https://github.com/leeakpareva/alex.git ~/my-agent
cd ~/my-agent
npm install
pip3 install --break-system-packages reportlab chromadb plotly kaleido
```

### 2. Create Workspace

```bash
mkdir -p ~/.alex/{memory,conversations,skills,tasks,templates,voice}
mkdir -p ~/.alex/files/uploads
mkdir -p ~/.alex/outputs/{reports,charts,diagrams,mindmaps,images,webapps}
mkdir -p ~/.alex/logs/{audit,tokens}
chmod 700 ~/.alex
```

### 3. Configure (`~/.alex/config.json`)

```json
{
  "anthropic_api_key": "sk-ant-...",
  "telegram_bot_token": "BOT_TOKEN_FROM_BOTFATHER",
  "telegram_owner_id": YOUR_TELEGRAM_USER_ID,
  "telegram_authorized_users": [],
  "telegram_notify_tasks": true,
  "gmail_address": "your.email@gmail.com",
  "gmail_app_password": "xxxx xxxx xxxx xxxx",
  "recipient_email": "default@recipient.com",
  "openai_api_key": "sk-...",
  "alphavantage_api_key": "YOUR_KEY",
  "control_api_token": "GENERATE_A_RANDOM_TOKEN",
  "slack_token": "xoxb-...",
  "slack_channel_id": "C0XXXXXXXX"
}
```

`chmod 600 ~/.alex/config.json`

| Key | Where to Get It |
|-----|----------------|
| `anthropic_api_key` | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `telegram_bot_token` | Telegram → @BotFather → /newbot |
| `telegram_owner_id` | Telegram → @userinfobot → send any message |
| `gmail_app_password` | Google Account → Security → 2FA → App Passwords |
| `openai_api_key` | [platform.openai.com](https://platform.openai.com) → API Keys |
| `alphavantage_api_key` | [alphavantage.co](https://www.alphavantage.co/support/#api-key) → free tier |
| `control_api_token` | Generate: `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` |

### 4. Define the Agent Identity (`~/.alex/IDENTITY.md`)

```markdown
# ALEX

You are ALEX, the Global Economist at NAVADA.
You provide economic research, market analysis, and strategic intelligence.
```

Change this file to create a completely different agent — a CTO, a sales lead, a research assistant, anything.

### 5. Deploy

```bash
sudo cp deploy/navada-1.service /etc/systemd/system/alex.service
sudo systemctl daemon-reload && sudo systemctl enable alex && sudo systemctl start alex

sudo cp deploy/cron/alex /etc/cron.d/alex
sudo cp deploy/cron/alex-tasks /etc/cron.d/alex-tasks
sudo chown root:root /etc/cron.d/alex*
```

### 6. Verify

```bash
sudo systemctl status alex          # Should show active (running)
journalctl -u alex -f               # Watch live logs
npx vitest run                       # Run test suite (96 tests)
```

Send a message to your bot on Telegram — it should respond.

---

## Cron Resilience

Three layers ensure scheduled tasks never get lost:

1. **Curl retry** — All cron entries use `curl --retry 3 --retry-delay 30 --retry-connrefused` (~90s retry window)
2. **Startup catch-up** — `catchUpMissedTasks()` runs on boot, checks `.last-alive` marker, fires any tasks whose scheduled hour was missed during downtime
3. **systemd restart** — `Restart=always` with `RestartSec=5` auto-recovers from crashes

### Default Scheduled Tasks

| Task | Schedule | Description |
|------|----------|-------------|
| `morning-briefing` | 08:00 daily | Market summary, overnight developments, day's agenda |
| `midmorning-checkin` | 11:00 daily | Proactive check-in with owner |
| `midday-research` | 13:00 daily | Midday research and market update |
| `afternoon-checkin` | 16:00 daily | Afternoon status update |
| `evening-summary` | 18:00 daily | End-of-day summary |
| `inbox-review` | 10:00, 15:00 daily | AI email triage and notifications |
| `dashboard-sync` | Hourly | Token metrics, service status, git commits to Redis |
| `cleanup` | 03:00 daily | Archive old conversations, prune stale files |
| `weekly-self-review` | Sun 22:00 | Self-improvement analysis and suggestions |

## Key Design Patterns

- **Dependency injection**: `executeTool()` receives all deps as a single object — never imports globals
- **Tiered permissions**: `OWNER_ONLY_TOOLS` set checked on every tool call with `callerUserId` context
- **Sensitive masking**: `maskSensitive()` redacts API keys, tokens, and passwords in all tool outputs
- **Token conservation**: Skill names only in system prompt, RAG top-3 chunks, rolling summaries, last 8 messages verbatim
- **Queue priority**: User messages = priority 10, scheduled tasks = priority 1
- **Fire-and-forget dashboard**: Dashboard POSTs never block the main response flow
- **Circuit breakers**: Per-provider (Anthropic, DeepSeek, OpenAI) — 5 failures opens circuit for 5 minutes
- **Natural acknowledgments**: 14 varied human-sounding responses instead of robotic "Let me check"
- **Scheduled task safety**: Tighter message window (12 vs 20) to prevent token overflow during tool loops
- **HTML notifications**: Heartbeat task results sent as HTML with plain-text fallback to avoid Telegram parse errors

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Bot not responding | `sudo systemctl status alex` then `journalctl -u alex -f` |
| Telegram 409 conflicts | Kill duplicate processes: `pgrep -af gateway.js` then kill the stale one |
| API errors | Check API key has credits, check config, use `/tokens` |
| Email not sending | Verify Gmail App Password (not regular password), ensure 2FA is on |
| Cron not firing | Check `/etc/cron.d/alex` has trailing newline, owned by root |
| Scheduled task prompt overflow | Tighter tool-loop window (12 msgs) — check logs for 200K token errors |
| High token usage | Use `/tokens` and `/costs` in Telegram, check model routing in logs |
| Control API 401 | Include `Authorization: Bearer <token>` header |
| Commands not in Telegram menu | Restart service — `setMyCommands` runs on startup |

## Quick Reference

```bash
npm start                              # Start gateway
npm run dev                            # Start with --watch
sudo systemctl restart alex            # Restart service
journalctl -u alex -f                  # Live logs
node --check src/*.js                  # Syntax check all source
npx vitest run                         # Run test suite
curl -X POST http://127.0.0.1:9090/api/trigger \
  -H 'Content-Type: application/json' \
  -d '{"task":"morning-briefing"}'     # Trigger a task manually
```

---

## License

MIT — Built by [NAVADA](https://www.navada.space)

*Clone it. Change the identity. Deploy your own AI agent.*
