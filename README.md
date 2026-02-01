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
| **PDF Reports** | Styled PDF reports with tables, charts, and NAVADA branding |
| **Data Analysis** | Python execution with numpy, pandas, matplotlib, seaborn, scipy, scikit-learn |
| **Charts** | Generate and send data visualisations directly in Telegram |
| **Voice** | Receive voice notes (Whisper transcription) and send voice responses (TTS) |
| **URL Fetching** | Hit any API, scrape any page, download data via `fetch_url` |
| **Scheduling** | Cron-based tasks, reminders, recurring jobs — 8 daily heartbeats by default |
| **Memory** | Persistent memory across all conversations with rolling summaries |
| **Skills** | Self-extending plugin system — the agent can create its own tools |
| **RAG** | ChromaDB vector search over knowledge base for relevant context retrieval |
| **Dashboard** | Live Vercel dashboard with real-time task tracking, token costs, activity log |
| **Multi-Platform** | Telegram + Slack + CLI + Control API |
| **Smart Routing** | Haiku for greetings, Sonnet for work, Opus on demand, DeepSeek for deep research, GPT-4o fallback |
| **Modes** | `/learn` (educational), `/mathematician` (quantitative), `/strategist` (frameworks), `/voice` (audio) |

---

## Security Model

The agent enforces a tiered permission system. The **owner** (configured Telegram ID) has full access to all tools and the host system. **All other users** can chat with the agent but have zero access to the Pi.

### Owner (full access)

All 25+ tools available including bash, file operations, email, code execution, scheduling, and system management.

### Other Users (conversation only)

| Allowed | Blocked |
|---------|---------|
| Chat with the agent | `bash` — shell commands |
| `web_lookup` — search the web | `read_file` / `write_file` / `edit_file` — filesystem |
| `web_search` — Claude web search | `list_directory` / `grep` / `glob` — filesystem browsing |
| `memory_recall` — read knowledge | `send_email` — email sending |
| | `generate_pdf` / `generate_chart` / `generate_image` — file creation |
| | `fetch_url` — HTTP requests |
| | `schedule_task` / `delete_task` — cron management |
| | `send_file` / `send_voice_message` — file exfiltration |
| | `create_skill` / `update_dashboard` / `memory_save` — system modification |

### Additional Protections

- **Sensitive data masking**: API keys, tokens, passwords, and secrets are automatically redacted (`xxxx`) in all tool outputs before reaching the model
- **Control API authentication**: Bearer token required for all non-cron API requests
- **Rate limiting**: 30 requests/minute per IP on the Control API
- **Delete guardrail**: File deletions require 3 confirmations + password
- **Circuit breaker**: Automatic API call suspension after repeated failures to prevent billing runaway

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
  → chat.js chat() → selectModel() routes to optimal model
  → buildSystemPrompt() with identity, memory, RAG context
  → prepareMessages() summarizes old messages, keeps last 12 verbatim
  → callAnthropicQueued() via priority queue + circuit breaker
  → processResponse() loops on tool_use blocks
    → tools.js executeTool() with permission check + sensitive masking
  → smartSplit() response at paragraph boundaries → send via Telegram/Slack
```

### Model Routing

| Trigger | Model | Cost/Call |
|---------|-------|-----------|
| Greetings, status checks, short messages (<80 chars) | Haiku 3.5 | ~$0.002 |
| Research, analysis, reports, emails, tools | Sonnet 4 | ~$0.10 |
| "use deepseek", deep research, thorough analysis | DeepSeek | ~$0.001 |
| "use gpt", explicit GPT request | GPT-4o | ~$0.05 |
| "use opus", maximum capability | Opus 4.5 | ~$0.30 |

### Source Modules

| Module | Purpose |
|--------|---------|
| `src/gateway.js` | Entry point. Telegram/Slack bots, authenticated control API, tool execution with dependency injection, permission enforcement, startup catch-up for missed tasks |
| `src/chat.js` | Chat system factory. Model selection, token logging, conversation summarisation, API calls with retry and fallback |
| `src/tools.js` | 25+ tool definitions + `executeTool()` switch. Owner-only permission enforcement, sensitive data masking, delete guardrail |
| `src/heartbeat.js` | Built-in task definitions, scheduled task execution through AI, dashboard sync, cleanup |
| `src/memory.js` | Persistent memory system. Per-chat conversations with rolling summaries, categorised memory, RAG integration |
| `src/skills.js` | Self-extending skill system. Skills stored as `~/.alex/skills/{name}/SKILL.md` |
| `src/slack.js` | Slack interface. Channel polling + DMs, threaded replies, mention-only filtering |
| `src/inbox.js` | Gmail inbox monitor. IMAP polling, AI reply generation, Telegram notifications |
| `src/config.js` | Config loader with validation, path security |
| `src/queue.js` | Priority request queue with circuit breaker and rate limit handling |

---

## Performance Tracking

Everything the agent does is measured in real time:

- **Token usage** — per-call logging by model, daily summaries, lifetime cost tracking
- **Task completion** — every task logged to the dashboard with status, category, token count, and cost
- **Activity log** — timestamped record of every action, visible on the live dashboard
- **Cost breakdown** — `/tokens` for today, `/spend` for lifetime, `/projection` for forecasts
- **Heartbeat monitoring** — 8 daily scheduled tasks with success/failure tracking
- **Session metrics** — uptime, API calls, conversations tracked, all visible via `/status`

### Cost to Run

Based on real production data (Jan-Feb 2026):

| Component | Daily | Monthly | Annual |
|-----------|-------|---------|--------|
| API tokens (Claude + OpenAI) | ~£8 | ~£244 | ~£2,964 |
| Raspberry Pi electricity (12W) | £0.07 | £2.15 | £25.75 |
| **Total** | **~£8** | **~£246** | **~£2,990** |

For comparison, a human doing the same job costs ~£50,000/year (UK mid-level + employer NI/pension/overhead). The agent delivers **94% cost savings** and works 24/7.

---

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/status` | System health — hardware, services, costs, session metrics |
| `/testreport` | Full system test report — health, tools, connectivity |
| `/brief` | Recent activity summary this session |
| `/news` | Latest gathered news and insights |
| `/research <topic>` | Deep research on any topic (runs in background) |
| `/inbox` | Email queue and AI triage |
| `/action <n>` | Act on a triaged email |
| `/stocks <symbol>` | Quick stock quote |
| `/tokens` | Today's API usage by model |
| `/spend` | Lifetime cost report with daily breakdown |
| `/projection` | Cost projection and ROI analysis |
| `/duties` | All cron duties, schedules, next runs |
| `/mathematician` | Toggle quantitative mode (full calculations, financial models) |
| `/strategist` | Toggle strategic mode (SWOT, Porter's, PESTLE frameworks) |
| `/learn` | Toggle educational mode (What / How / Why) |
| `/voice` | Toggle voice reply mode |
| `/models` | Switch AI model or restore auto-routing |
| `/memory` | Browse memory banks |
| `/skills` | List custom skills |
| `/tasks` | List scheduled tasks |
| `/dashboard` | Live dashboard link |
| `/clear` | Clear conversation history |
| `/help` | Full guide with tips |

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
mkdir -p ~/.alex/{memory,conversations,skills,tasks,reports,research,data,logs,charts,images,uploads,voice,templates}
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
  "control_api_token": "GENERATE_A_RANDOM_TOKEN",
  "slack_token": "xoxb-...",
  "slack_channel_id": "C0XXXXXXXX"
}
```

`chmod 600 ~/.alex/config.json`

**Note:** Leave `telegram_authorized_users` empty to allow anyone to chat. Only the `telegram_owner_id` gets system access — everyone else is conversation-only.

| Key | Where to Get It |
|-----|----------------|
| `anthropic_api_key` | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `telegram_bot_token` | Telegram → @BotFather → /newbot |
| `telegram_owner_id` | Telegram → @userinfobot → send any message |
| `gmail_app_password` | Google Account → Security → 2FA → App Passwords |
| `openai_api_key` | [platform.openai.com](https://platform.openai.com) → API Keys |
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
sudo cp navada-1.service /etc/systemd/system/alex.service
sudo systemctl daemon-reload && sudo systemctl enable alex && sudo systemctl start alex

sudo cp cron/alex /etc/cron.d/alex
sudo cp cron/alex-tasks /etc/cron.d/alex-tasks
sudo chown root:root /etc/cron.d/alex*
```

### 6. Verify

```bash
sudo systemctl status alex          # Should show active (running)
journalctl -u alex -f               # Watch live logs
```

Send a message to your bot on Telegram — it should respond.

---

## Cron Resilience

Three layers ensure scheduled tasks never get lost:

1. **Curl retry** — All cron entries use `curl --retry 3 --retry-delay 30 --retry-connrefused` (~90s retry window)
2. **Startup catch-up** — `catchUpMissedTasks()` runs on boot, checks `.last-alive` marker, fires any tasks whose scheduled hour was missed during downtime
3. **systemd restart** — `Restart=always` with `RestartSec=10` auto-recovers from crashes

## Key Design Patterns

- **Dependency injection**: `executeTool()` receives all deps as a single object — never imports globals
- **Tiered permissions**: `OWNER_ONLY_TOOLS` set checked on every tool call with `callerUserId` context
- **Sensitive masking**: `maskSensitive()` redacts API keys, tokens, and passwords in all tool outputs
- **Token conservation**: Skill names only in system prompt, RAG top-3 chunks, rolling summaries, last 12 messages verbatim
- **Queue priority**: User messages = priority 10, scheduled tasks = priority 1
- **Fire-and-forget dashboard**: Dashboard POSTs never block the main response flow
- **Circuit breaker**: API calls suspended after 5 consecutive failures, auto-recovers after 5 minutes

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Bot not responding | `sudo systemctl status alex` then `journalctl -u alex -f` |
| API errors | Check API key has credits, check config, use `/tokens` |
| Email not sending | Verify Gmail App Password (not regular password), ensure 2FA is on |
| Cron not firing | Check `/etc/cron.d/alex` has trailing newline, owned by root |
| High token usage | Use `/tokens` in Telegram, check Haiku routing in logs |
| Control API 401 | Include `Authorization: Bearer <token>` header |

## Quick Reference

```bash
sudo systemctl restart alex                    # Restart
journalctl -u alex -f                          # Live logs
node --check src/*.js                          # Syntax check
curl -X POST http://127.0.0.1:9090/api/trigger \
  -H 'Content-Type: application/json' \
  -d '{"task":"morning-briefing"}'             # Trigger a task
```

---

## License

MIT — Built by [NAVADA](https://www.navada.space)

*Clone it. Change the identity. Deploy your own AI agent.*
