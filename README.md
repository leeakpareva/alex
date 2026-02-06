# NAVADA AI Agent Framework

**A production-grade autonomous AI agent that runs 24/7 on a Raspberry Pi 5.**

Built as **ALEX**, the Global Economist at NAVADA — a real employee that researches markets, sends emails, generates reports, monitors inboxes, posts to LinkedIn, manages calendars, and runs its own schedule. Designed to be cloned and re-personalised into any AI agent role.

**Live Dashboard:** [www.alexnavada.xyz](https://www.alexnavada.xyz)

[![Tests](https://img.shields.io/badge/tests-136%20passing-brightgreen)](#test-suite)
[![Models](https://img.shields.io/badge/AI%20models-18-blue)](#model-routing)
[![Tools](https://img.shields.io/badge/tools-31+-orange)](#tools-31)
[![Uptime](https://img.shields.io/badge/uptime-24%2F7-success)](#cron-resilience)

---

## Why This Exists

Most AI agents are demos. ALEX is a deployed, measurable team member running in production since January 2026. Every action is logged, every token is costed, every task is tracked on a live dashboard. You can see exactly what the agent did, when, and how much it cost — in real time.

The framework solves the hard problems of running an AI agent 24/7:

- **Conversation memory** that doesn't blow up context windows (rolling summaries + RAG)
- **Daily journal** — every interaction logged to dated markdown files, nightly indexed into ChromaDB and archived
- **Graceful API failures** with circuit breakers, retry logic, and multi-provider fallback
- **Cron resilience** across reboots with 3-layer task recovery
- **Multi-model routing** across 5 AI providers to control costs and maximise capability
- **Dual data stores** — ChromaDB Cloud for vector search + local Redis for fast caching
- **A security model** that lets external users interact without exposing the host
- **Self-extending skills** — the agent can create its own tools at runtime

For comparison, a human doing the same job costs ~£50,000/year. ALEX delivers **94% cost savings** and works 24/7/365.

---

## What ALEX Can Do

| Capability | Description |
|------------|-------------|
| **Multi-Model AI** | 18 models across 5 providers — Claude, OpenAI, DeepSeek, Kimi K2. Smart routing picks the best model for each task |
| **Research** | Web search, market analysis, real-time financial data (stocks, crypto, economic indicators) |
| **Email** | Draft and send HTML emails with attachments, branded templates, auto-CC |
| **Gmail Inbox** | IMAP polling every 2 min — AI triage, auto-replies, priority scoring, Telegram notifications |
| **Email Filing** | AI-powered email categorisation, priority scoring, status tracking, and bulk management |
| **LinkedIn** | OAuth 2.0 posting — text, links, and images. Publish directly from Telegram |
| **Google Calendar** | List, create, update, and delete calendar events. Schedule meetings from chat |
| **PDF Reports** | Styled PDF reports with tables, charts, and branding |
| **Data Analysis** | Full Python execution — numpy, pandas, matplotlib, seaborn, scipy, scikit-learn |
| **Charts & Graphs** | Generate and send data visualisations directly as images in Telegram |
| **Diagrams** | Mermaid rendering (flowcharts, sequence, ER, Gantt, pie, class, state) to PNG |
| **Mind Maps** | Markmap mind map generation from markdown outlines to PNG |
| **Web Apps** | Generate self-contained interactive HTML apps (dashboards, calculators, data tables) |
| **Voice** | Receive voice notes (Whisper transcription) and send voice responses (TTS) |
| **Image Generation** | DALL-E 3 image generation from natural language prompts |
| **URL Fetching** | Hit any API, scrape any page, download data — full HTTP verb support |
| **Scheduling** | Cron-based tasks, reminders, recurring jobs — 8+ daily heartbeats by default |
| **Daily Journal** | Every Q&A exchange logged to dated markdown files, organised by month. Private diary tracks ALEX's own activity. 2 AM nightly churn indexes to ChromaDB and archives |
| **Memory** | Persistent memory across conversations with rolling summaries, auto-fact extraction, and RAG |
| **Skills** | Self-extending plugin system — the agent can create its own tools at runtime |
| **Dashboard** | Live Vercel dashboard with real-time task tracking, token costs, and activity log |
| **Desktop Terminal** | PyQt5 desktop chat UI with voice I/O via Bluetooth speaker ([alex-terminal](https://github.com/leeakpareva/alex-terminal)) |
| **Multi-Platform** | Telegram + Slack + Gmail + LinkedIn + Google Calendar + Desktop Terminal + Control API |
| **Modes** | `/learn`, `/mathematician`, `/strategist`, `/python`, `/voice` — stackable specialist modes |
| **User Management** | Add/remove Telegram users, grant/revoke full access with tiered permissions |
| **Dual Storage** | ChromaDB Cloud (vector search, RAG) + local Redis (journal cache, short-term data) + Upstash Redis (dashboard) |

---

## Model Routing — 18 Models, 5 Providers

ALEX automatically selects the optimal model for each message, or you can override manually via `/models` or inline commands like "use kimi".

### Providers

| Provider | Models | Tool Support | Notes |
|----------|--------|-------------|-------|
| **Anthropic** | Haiku 3.5, Sonnet 4, Opus 4.5 | Full (31+ tools) | Primary provider. Prompt caching, web search |
| **Kimi (Moonshot AI)** | Kimi K2, Kimi K2 Thinking | Full (31+ tools) | 1T parameter MoE. 128K-256K context. ~6x cheaper than Sonnet |
| **OpenAI** | GPT-4o, GPT-4.1 family, GPT-5 family, o3, o4-mini | Text only | 12 models. Reasoning modes for o3/o4-mini/GPT-5 |
| **DeepSeek** | DeepSeek Chat | Text only | Deep research and analysis at ultra-low cost |

### Smart Routing Logic

| Trigger | Model | Why |
|---------|-------|-----|
| Greetings, status, short messages (<80 chars) | Haiku 3.5 | Fast, cheap (~$0.002/call) |
| Complex tasks, reports, building, emails | Sonnet 4 | Best all-rounder (~$0.10/call) |
| "use kimi" | Kimi K2 | Full tools, 6x cheaper than Sonnet |
| "use kimi thinking" | Kimi K2 Thinking | 256K reasoning mode |
| "use deepseek", "deep research" | DeepSeek | Ultra-cheap analysis (~$0.001/call) |
| "use gpt", "use o3", "use gpt-5" etc. | OpenAI variants | Specific model selection |
| "use opus" | Opus 4.5 | Maximum capability (~$0.30/call) |

All models have independent circuit breakers — 5 consecutive failures trips the breaker for 5 minutes, then auto-recovers. Anthropic failures cascade to OpenAI GPT-4o as a fallback.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Agent Gateway                                │
│                        (src/gateway.js)                               │
├──────────┬─────────┬─────────┬──────────┬──────────┬────────────────┤
│ Telegram │  Slack  │  Gmail  │ LinkedIn │ Calendar │ Desktop        │
│   Bot    │   Bot   │  Inbox  │  OAuth   │  G-Cal   │ Terminal       │
├───────────┴──────────┴──────────┴───────────┴───────────────────────┤
│                      Chat System (src/chat.js)                        │
│  Smart Model Routing → Priority Queue → Circuit Breakers → Retry     │
├──────────────────────────────────────────────────────────────────────┤
│  Anthropic (Haiku/Sonnet/Opus)  │  Kimi K2 (OpenAI-compatible)      │
│  OpenAI (GPT-4o/4.1/5/o3/o4)   │  DeepSeek (deep research)         │
├──────────────────────────────────────────────────────────────────────┤
│  31+ Tools │ Skills System │ Memory + RAG │ Python Execution         │
├──────────────────────────────────────────────────────────────────────┤
│  Daily Journal │ Document Pipeline │ Content Cache │ Diary System    │
├──────────────────────────────────────────────────────────────────────┤
│  ChromaDB Cloud (vector search)  │  Local Redis  │  Upstash Redis   │
├──────────────────────────────────────────────────────────────────────┤
│                     Raspberry Pi 5 (8GB RAM)                          │
│        24/7 systemd + cron scheduling + 3-layer auto-recovery        │
├──────────────────────────────────────────────────────────────────────┤
│            Dashboard: Upstash Redis → Vercel (live)                   │
└──────────────────────────────────────────────────────────────────────┘
```

### Message Flow

```
Telegram/Slack/Gmail message
  → gateway.js (dedup + auth + permission tier)
  → downloads photos/docs/voice as content blocks
  → voice notes: Whisper transcription → text
  → chat.js chat() → selectModel() routes to optimal model/provider
  → buildSystemPrompt() with identity, memory, RAG context
  → prepareMessages() summarises old messages, keeps last 8 verbatim
  → callAnthropicQueued() / callKimiWithTools() / callDeepSeek() / callOpenAI()
  → processResponse() loops on tool_use / function_call blocks
  → smartSplit() response at paragraph boundaries → send via Telegram/Slack
```

### Source Modules (13,000+ lines)

| Module | Lines | Purpose |
|--------|------:|---------|
| `src/gateway.js` | 5,085 | Entry point. Telegram/Slack bots, control API, tool execution with DI, 42+ commands, journal hooks, dual Redis, startup catch-up |
| `src/tools.js` | 2,099 | 31+ tool definitions + `executeTool()`. Permissions, masking, delete guardrail, timeouts |
| `src/chat.js` | 1,369 | Chat system factory. 18-model routing, token logging, summarisation, circuit breakers, diary context injection, auto-fact extraction |
| `src/inbox.js` | 777 | Gmail inbox monitor. IMAP polling, AI reply generation, Telegram notifications |
| `src/email-filing.js` | 464 | Email filing and categorisation. AI triage, priority scoring, status management |
| `src/heartbeat.js` | 406 | Scheduled tasks, dashboard sync, cleanup, diary logging. HTML notifications with plain-text fallback |
| `src/slack.js` | 384 | Slack interface. Channel polling + DMs, threaded replies, mention-only filtering |
| `src/daily-journal.js` | 372 | **Daily journal system.** Captures all Q&A to dated files, private diary, Redis caching, 2 AM nightly churn (ChromaDB index + archive) |
| `src/memory.js` | 330 | Persistent memory. Per-chat conversations with rolling summaries, categorised memory, RAG |
| `src/skills.js` | 226 | Self-extending skill system. Skills stored as `~/.alex/skills/{name}/SKILL.md` |
| `src/linkedin.js` | 221 | LinkedIn OAuth 2.0. Text posts, link sharing, image uploads |
| `src/google-calendar.js` | 213 | Google Calendar. List, create, update, delete events with OAuth token refresh |
| `src/document-processor.js` | ~200 | Upload pipeline — PDF/DOCX/image OCR extraction, LESLIE marker splitting, ChromaDB indexing |
| `src/content-cache.js` | ~170 | Content fact cache — stores extracted facts from heartbeat outputs (3-day TTL, 50-entry cap) |
| `src/config.js` | 126 | Config loader with schema validation, path security, ChromaDB and Redis config |
| `src/queue.js` | 113 | Priority request queue with 429 cooldown and rate limit handling |
| `src/keyword-index.js` | 93 | Inverted keyword index with TF scoring for memory recall fallback |
| `src/apify-scrapers.js` | ~100 | Apify web scraper helpers (TikTok, etc.) |
| `src/secrets.js` | ~150 | AES-256-GCM config encryption/decryption |
| `src/alerts.js` | 55 | Stock and service alert threshold monitoring |
| `scripts/rag_manager.py` | 279 | RAG bridge — Python CLI bridging Node.js to ChromaDB Cloud (index-text, query, cleanup, stats) with local fallback |

---

## Security Model

The agent enforces a two-tier permission system at both the **command** and **tool** level.

### Owner (full access)

All 31+ tools, all 40 Telegram commands, all integrations.

### Limited Users (chat + safe tools)

Limited users can chat with the agent and use safe, read-only tools. Everything that touches the filesystem, shell, email, scheduling, or costs money is blocked at the API level.

| Allowed Tools (All Users) | Blocked Tools (Owner Only) |
|--------------------------|---------------------------|
| `web_lookup`, `web_search` | `bash`, `read_file`, `write_file`, `edit_file` |
| `memory_recall` | `list_directory`, `grep`, `glob` |
| `stock_quote`, `stock_search`, `company_overview` | `send_email`, `fetch_url`, `generate_pdf` |
| `market_news`, `crypto_rate`, `economic_indicator` | `generate_image`, `generate_webapp` |
| `generate_chart`, `generate_diagram`, `generate_mindmap` | `schedule_task`, `delete_task`, `confirm_delete` |
| `get_recent_uploads` | `send_file`, `send_voice_message`, `manage_user` |
| | `create_skill`, `update_dashboard`, `memory_save` |
| | `linkedin_post`, `calendar_*` tools |

### Additional Protections

- **Sensitive data masking** — API keys, tokens, passwords automatically redacted in all tool outputs
- **Control API authentication** — Bearer token required for all non-cron requests
- **Rate limiting** — Per-user Telegram rate limits (40/min owner, 20/min users) + 30 req/min API
- **CORS hardening** — Restricted origins and body size limits
- **Delete guardrail** — File deletions require 3 confirmations + password
- **Bash blocklist** — `mkfs`, `dd`, `reboot`, `shutdown`, `systemctl stop alex`, `chmod 777 /`, pipe-to-shell all blocked
- **Tool timeouts** — bash 300s, chart 180s, diagram/mindmap 60s, default 30s
- **Circuit breakers** — Per-provider (Anthropic, DeepSeek, OpenAI, Kimi) — auto-recovery after 5 minutes
- **Tool output truncation** — Large outputs capped to prevent token blowout
- **Message length limit** — 50,000 character cap on incoming messages

---

## Telegram Commands (42+)

All commands are registered in Telegram's `/` autocomplete menu.

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
| `/fixes` | Recent changelog entries |
| `/health` | Quick system health overview |
| `/help` | Full guide with tips and mode descriptions |
| `/id` | Your Telegram user and chat ID |
| `/inbox` | Email queue. Supports: `clear`, `done all`, `delete`, `mark` |
| `/kill` | Emergency stop — halts all in-flight AI processing immediately |
| `/learn` | Toggle educational mode (What / How / Why structure) |
| `/logs` | Recent audit log entries |
| `/mathematician` | Toggle quantitative mode (calculations, financial models, statistics) |
| `/memory` | Browse memory banks |
| `/mode` | Show active modes |
| `/models` | Switch AI model (18 models) or restore auto-routing |
| `/news` | Latest gathered news and insights |
| `/profile` | ALEX personal details and owner info |
| `/projection` | Cost projection and ROI analysis |
| `/python` | Toggle Python mode (forces Python execution for all analysis) |
| `/read` | Show last 5 diary entries (ALEX's private activity log) |
| `/research <topic>` | Deep research on any topic (runs in background) |
| `/save` | Save current conversation to daily journal file |
| `/skills` | List custom skills |
| `/spend` | Lifetime cost report with daily breakdown |
| `/start` | Welcome message |
| `/status` | System health — hardware, services, costs, session metrics |
| `/stocks <symbol>` | Quick stock quote (Alpha Vantage) |
| `/strategist` | Toggle strategic mode (SWOT, Porter's, PESTLE frameworks) |
| `/tasks` | List scheduled and recurring tasks |
| `/testreport` | Full system test report (health, tools, connectivity) |
| `/tokens` | Today's API usage by model |
| `/tracked` | View tracked tasks (TASK, MEETING, DEADLINE keywords) |
| `/voice` | Toggle voice reply mode (TTS responses) |

Modes can be stacked: `/mathematician` + `/strategist` gives quantitative strategic analysis.

---

## Tools (31+)

| Tool | Access | Description |
|------|--------|-------------|
| `bash` | Owner | Execute shell commands (with blocklist for dangerous ops) |
| `read_file` | Owner | Read any file on the Pi |
| `write_file` | Owner | Write files (path-restricted) |
| `edit_file` | Owner | Precise text replacement in files |
| `list_directory` | Owner | Browse filesystem |
| `grep` | Owner | Regex search across files |
| `glob` | Owner | Find files by name pattern |
| `web_lookup` | All | DuckDuckGo web search |
| `web_search` | All | Claude built-in web search |
| `memory_save` | Owner | Save to persistent categorised memory |
| `memory_recall` | All | Read from persistent memory + RAG |
| `send_email` | Owner | HTML emails with templates, attachments, and auto-CC |
| `generate_pdf` | Owner | Professional PDF reports with branding |
| `generate_chart` | All | Python data analysis and visualisation to PNG |
| `generate_diagram` | All | Mermaid diagrams to PNG (flowchart, sequence, ER, Gantt, pie, class, state) |
| `generate_mindmap` | All | Markmap mind maps to PNG |
| `generate_webapp` | Owner | Self-contained interactive HTML web apps |
| `generate_image` | Owner | DALL-E 3 image generation |
| `schedule_task` | Owner | Create cron-based scheduled tasks |
| `delete_task` | Owner | Remove scheduled tasks |
| `confirm_delete` | Owner | Execute file deletion (3 confirmations + password) |
| `create_skill` | Owner | Create new agent skills at runtime |
| `update_dashboard` | Owner | Push data to live dashboard |
| `send_file` | Owner | Send any file via Telegram |
| `send_voice_message` | Owner | Text-to-speech voice messages |
| `fetch_url` | Owner | HTTP requests (GET/POST/PUT/PATCH/DELETE) |
| `stock_quote` | All | Real-time stock prices |
| `stock_search` | All | Search stock ticker symbols |
| `company_overview` | All | Company fundamentals and financials |
| `market_news` | All | Market news with sentiment analysis |
| `crypto_rate` | All | Cryptocurrency exchange rates |
| `economic_indicator` | All | US economic data (GDP, CPI, unemployment, etc.) |
| `manage_user` | Owner | Add/remove Telegram users, grant/revoke full access |
| `get_recent_uploads` | All | List recently uploaded files |
| `linkedin_post` | Owner | Post to LinkedIn (text, links, images) |
| `calendar_list_events` | Owner | List upcoming Google Calendar events |
| `calendar_create_event` | Owner | Create calendar events |
| `calendar_update_event` | Owner | Update existing calendar events |
| `calendar_delete_event` | Owner | Delete calendar events |

---

## Integrations

### Telegram (Primary Interface)
Full-featured bot with 40+ slash commands, inline model selection, voice notes, photo/document handling, and tiered user permissions.

### Slack
Channel polling with threaded replies, mention-only filtering, and DM support. Shares the same chat system and tools as Telegram.

### Gmail
IMAP polling every 2 minutes. AI-powered triage scores incoming emails by priority, generates suggested replies, and sends Telegram notifications. Full email filing system with status tracking (`not_started` → `in_progress` → `done`).

### LinkedIn
OAuth 2.0 integration for publishing posts directly from Telegram. Supports text posts, link sharing, and image uploads. Token auto-refresh.

### Google Calendar
Full CRUD for calendar events. List upcoming meetings, create new events, update or cancel existing ones — all from Telegram.

### Control API (Port 9090)
Authenticated REST API for programmatic access:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/command` | POST | Run a message through the chat system |
| `/api/send` | POST | Direct message to a Telegram user |
| `/api/trigger` | POST | Trigger a scheduled task by name |
| `/api/users` | GET | List known Telegram users |
| `/api/broadcast` | POST | Message all known users |
| `/api/health` | GET | Health check endpoint |
| `/api/trigger` (file-received) | POST | Process uploaded file through document pipeline (fire-and-forget) |
| `/api/terminal-messages` | GET | Fetch and clear queued messages for ALEX Terminal |

Localhost requests to `/api/trigger`, `/api/command`, `/api/health`, and `/api/terminal-messages` bypass authentication.

### ALEX Terminal Integration

The [ALEX Terminal](https://github.com/leeakpareva/alex-terminal) connects via `/api/command` with an `X-Terminal: true` header. This gives the terminal:

- **Separate conversation context** (`terminal-chat` vs `control-api`) — terminal and Telegram conversations are independent
- **Terminal-aware responses** — ALEX knows it's in a text-only terminal and avoids image/chart tools, keeps responses concise
- **Autonomous notifications** — heartbeat task results are queued to `~/.alex/terminal-queue.json` and displayed in the terminal
- **Voice I/O** — OpenAI TTS (onyx voice) + Whisper STT via USB mic, output through Bluetooth speaker

---

## Daily Journal & Diary System

ALEX maintains a comprehensive daily journal of all interactions and a private activity diary.

### Daily Journal (`src/daily-journal.js`)

Every Q&A exchange — Telegram, Terminal, API, web, scheduled tasks — is captured to a dated markdown file organised by month:

```
~/.alex/daily/
├── Feb-2026/
│   ├── Thursday-05-Feb-2026.md
│   ├── Friday-06-Feb-2026.md
│   └── ...
├── Mar-2026/
│   └── ...
```

**Format:**
```
Q: Leslie - What's CPI?
A: Alex (DeepSeek) - 2.7%. Source: BLS.
Q: Leslie - Climate risk?
A: Alex (Opus) - Lagos flooding up 30%...
```

### Private Diary (`~/.alex/diary/progress.txt`)

ALEX logs its own activities — boot events, task completions, failures:

```
06/02/2026 08:15 ALEX booted, all systems online
06/02/2026 08:16 morning-briefing completed
06/02/2026 09:02 Reuters scrape FAILED: timeout
```

### Nightly Churn (2 AM)

At 2 AM daily, a churn job runs automatically:
1. **Index** all daily markdown files into ChromaDB Cloud (`daily_memories` collection, 350-char chunks, 30-day TTL)
2. **Extract facts** from the diary using Haiku → save as `diary/facts.json`
3. **Archive** daily files to `~/.alex/archive/weekly-YYYY-MM-DD.tar.gz`
4. **Clean** expired entries from ChromaDB
5. **Cache** facts to Redis (`cache:long:week`, 7-day TTL)

### Telegram Commands

- `/save` — dump current conversation to today's daily file
- `/read` — show last 5 diary entries

---

## Caching & Storage Architecture

### Data Stores

| Store | Type | Purpose |
|-------|------|---------|
| **ChromaDB Cloud** | Vector database | RAG semantic search, daily journal indexing, document embeddings |
| **Local Redis** | Key-value cache | Journal short cache (`cache:short:day`), fast local data |
| **Upstash Redis** | Cloud key-value | Dashboard data (`dash:*`), API response cache, contacts, API keys |

### Four-Layer Caching

**1. Journal Short Cache** (Local Redis)
Last 20 lines of today's daily file cached in `cache:short:day` (24h TTL). Updated after every exchange. Used for quick context injection.

**2. Content Fact Cache** (`src/content-cache.js`)
After each heartbeat task, Haiku extracts key data points (stock prices, market moves, research findings) and caches them as structured facts in `~/.alex/cache/content/`. Facts have a 3-day TTL and 50-entry cap. When ALEX needs similar data again, cached facts are injected into the prompt instead of making fresh API calls.

**3. RAG Document Pipeline** (`src/document-processor.js` → `scripts/rag_manager.py`)
Files uploaded via Tailscale are automatically processed:
- PDF → pdftotext (fallback: PyTesseract OCR for scanned documents)
- DOCX → python-docx, XLSX → openpyxl, Images → PyTesseract OCR
- Text is chunked (500 chars, 50 overlap) and indexed in ChromaDB Cloud
- Documents with "Manager Notes" / "Leslie's Notes" markers are split: general content gets 5-day TTL, manager notes are indexed permanently
- Expired entries cleaned automatically during daily cleanup

**4. API Response Cache** (Vercel/Upstash Redis)
The public API at alexnavada.xyz caches responses in Upstash Redis:
- 30 futuristic AI-economy endpoints: 7-day cache (data changes slowly)
- 30 original endpoints: 1-hour cache (more time-sensitive)
- Cache key: `cache:v1:{endpoint}:{paramHash}`

---

## Performance Tracking

Everything the agent does is measured in real time:

- **Token usage** — per-call logging by model with source attribution (telegram, scheduled, api)
- **Cost breakdown** — `/tokens` for today, `/spend` for lifetime, `/costs` for per-task attribution, `/projection` for forecasts
- **Activity log** — timestamped record of every action, visible on the live dashboard
- **Heartbeat monitoring** — 8+ daily scheduled tasks with success/failure tracking
- **Session metrics** — uptime, API calls, conversations tracked, all visible via `/status`
- **Auto-fact extraction** — key facts automatically saved to knowledge base every 20 messages
- **Auto-reminder detection** — deadlines and reminders detected and saved to task memory

### Cost to Run

Based on real production data (Jan-Feb 2026):

| Component | Daily | Monthly | Annual |
|-----------|-------|---------|--------|
| API tokens (Claude + OpenAI + Kimi) | ~£8 | ~£244 | ~£2,964 |
| Raspberry Pi electricity (12W) | £0.07 | £2.15 | £25.75 |
| **Total** | **~£8** | **~£246** | **~£2,990** |

Human equivalent cost: ~£50,000/year (UK mid-level + employer NI/pension/overhead).

---

## Test Suite

136 tests across 9 test files — unit tests and end-to-end tests.

```bash
npx vitest run
```

| Suite | Tests | Coverage |
|-------|------:|----------|
| syntax-check (e2e) | 2 | All source files pass `node --check` |
| file-integrity (e2e) | 31 | Critical files exist and have expected content |
| control-api (e2e) | 9 | API endpoints respond correctly |
| core-improvements (unit) | 25 | Model selection, circuit breakers, queue, smart split |
| tools (unit) | 26 | Tool execution, permissions, guardrails |
| email-filing (unit) | 17 | Email triage, filing, status management |
| inbox (unit) | 13 | Gmail parsing, thread detection |
| config (unit) | 10 | Config loading, validation, path security |
| heartbeat (unit) | 5 | Scheduled task definitions and execution |

---

## Setup Guide

### 1. Clone and Install

```bash
git clone https://github.com/leeakpareva/alex.git ~/my-agent
cd ~/my-agent
npm install
pip3 install --break-system-packages reportlab chromadb plotly kaleido
```

**Requirements:** Node.js 22+, Python 3.11+, Raspberry Pi 5 (or any Linux box)

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
  "telegram_owner_id": 123456789,
  "telegram_authorized_users": [],
  "telegram_notify_tasks": true
}
```

`chmod 600 ~/.alex/config.json`

**Required keys:**

| Key | Where to Get It |
|-----|----------------|
| `anthropic_api_key` | [console.anthropic.com](https://console.anthropic.com) |
| `telegram_bot_token` | Telegram @BotFather → /newbot |
| `telegram_owner_id` | Telegram @userinfobot |

**Optional keys (enable more features):**

| Key | Enables | Source |
|-----|---------|--------|
| `openai_api_key` | GPT models, DALL-E, Whisper, TTS, fallback | [platform.openai.com](https://platform.openai.com) |
| `kimi_api_key` | Kimi K2 models (cheap tool-enabled AI) | [kimi-k2.ai](https://kimi-k2.ai) |
| `deepseek_api_key` | DeepSeek deep research | [platform.deepseek.com](https://platform.deepseek.com) |
| `gmail_address` + `gmail_app_password` | Email sending and inbox monitoring | Google Account → App Passwords |
| `alphavantage_api_key` | Financial data (stocks, crypto, economics) | [alphavantage.co](https://www.alphavantage.co/support/#api-key) |
| `slack_token` + `slack_channel_id` | Slack integration | Slack App dashboard |
| `control_api_token` | Authenticated Control API | `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `linkedin_*` keys | LinkedIn posting | LinkedIn Developer Portal |
| `google_calendar_*` keys | Google Calendar | Google Cloud Console |
| `upstash_redis_url` + `upstash_redis_token` | Live Vercel dashboard | [upstash.com](https://upstash.com) |
| `local_redis_url` | Local Redis for journal caching | Default: `redis://127.0.0.1:6379` |
| `chromadb_api_key` | ChromaDB Cloud vector search | [trychroma.com](https://www.trychroma.com) |
| `chromadb_tenant` + `chromadb_database` | ChromaDB Cloud tenant/database | Chroma Cloud dashboard |

### 4. Define the Agent Identity (`~/.alex/IDENTITY.md`)

```markdown
# ALEX

You are ALEX, the Global Economist at NAVADA.
You provide economic research, market analysis, and strategic intelligence.
```

Change this file to create a completely different agent — a CTO, a sales lead, a research assistant, a customer support agent, anything.

### 5. Deploy

```bash
# Service
sudo cp deploy/navada-1.service /etc/systemd/system/alex.service
sudo systemctl daemon-reload && sudo systemctl enable alex && sudo systemctl start alex

# Cron (scheduled tasks)
sudo cp deploy/cron/alex /etc/cron.d/alex
sudo cp deploy/cron/alex-tasks /etc/cron.d/alex-tasks
sudo chown root:root /etc/cron.d/alex*
```

### 6. Verify

```bash
sudo systemctl status alex          # Should show active (running)
journalctl -u alex -f               # Watch live logs
npx vitest run                       # Run test suite (136 tests)
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
| `daily-churn` | 02:00 daily | Index daily journal to ChromaDB, extract facts, archive old files |
| `cleanup` | 03:00 daily | Archive old conversations, prune stale files |
| `weekly-self-review` | Sun 22:00 | Self-improvement analysis and suggestions |

---

## Workspace Layout

```
~/.alex/
├── config.json              # API keys (mode 0600)
├── IDENTITY.md              # Agent personality and role definition
├── USER.md                  # User information
├── KNOWLEDGE.md             # Accumulated knowledge base
├── daily/                   # Daily journal files by month
│   ├── Feb-2026/            #   Friday-06-Feb-2026.md, etc.
│   └── Mar-2026/            #   One .md per day with all Q&A exchanges
├── diary/                   # ALEX's private activity diary
│   ├── progress.txt         #   Timestamped action log
│   └── facts.json           #   Extracted facts from nightly churn
├── archive/                 # Archived journal tarballs
│   └── weekly-2026-02-06.tar.gz
├── conversations/           # Per-chat JSON with messages + rolling summary
├── memory/                  # Categorised memory (user, projects, research, tasks)
├── skills/                  # Skill definitions (SKILL.md per skill)
├── tasks/                   # Scheduled task JSON definitions
├── templates/               # Email templates (signature, daily-summary, etc.)
├── files/
│   └── uploads/             # Files received via Telegram or Taildrop
├── outputs/
│   ├── reports/             # Generated PDFs
│   ├── charts/              # Generated charts and visualisations
│   ├── diagrams/            # Mermaid diagrams
│   ├── mindmaps/            # Markmap mind maps
│   ├── images/              # DALL-E generated images
│   └── webapps/             # Generated HTML web applications
├── cache/content/          # Extracted fact cache (3-day TTL)
├── chromadb/               # Local ChromaDB fallback (primary is Cloud)
├── logs/
│   ├── audit/               # Tool execution and error audit logs
│   └── tokens/              # Per-day token usage JSONL files
└── voice/                   # Voice notes and transcriptions
```

---

## Key Design Patterns

- **Dependency injection** — `executeTool()` receives all deps as a single object. Never imports globals
- **Tiered permissions** — `OWNER_ONLY_TOOLS` checked on every tool call with `callerUserId` context
- **Sensitive masking** — `maskSensitive()` redacts API keys, tokens, and passwords in all tool outputs
- **Token conservation** — skill names only in system prompt, RAG top-3 chunks, rolling summaries, last 8 messages verbatim
- **Queue priority** — user messages = priority 10, scheduled tasks = priority 1
- **Fire-and-forget dashboard** — dashboard POSTs never block the main response flow
- **Circuit breakers** — per-provider (Anthropic, DeepSeek, OpenAI, Kimi) with independent failure tracking
- **Natural acknowledgments** — 14 varied human-sounding responses instead of robotic filler
- **Scheduled task safety** — tighter message window (12 vs 20) to prevent token overflow during tool loops
- **OpenAI-compatible providers** — Kimi K2 uses the same OpenAI SDK with custom baseURL, making it trivial to add more providers
- **Four-layer caching** — journal short cache (24h), content facts (3-day), RAG documents (5-day TTL / permanent), API responses (1h / 7-day)
- **Dual Redis** — local Redis for fast journal caching, Upstash Redis for dashboard and API data
- **ChromaDB Cloud** — vector search with automatic local fallback if cloud is unreachable
- **Daily journaling** — every Q&A exchange logged with model attribution, nightly indexed and archived
- **Upload auto-processing** — Tailscale → taildrop-watcher.sh → `/api/trigger` → document-processor.js → ChromaDB (fire-and-forget)

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Bot not responding | `sudo systemctl status alex` then `journalctl -u alex -f` |
| Telegram 409 conflicts | Kill duplicate processes: `pgrep -af gateway.js` |
| API errors | Check API key credits, check config, use `/tokens` |
| Email not sending | Verify Gmail App Password (not regular password), ensure 2FA is on |
| Cron not firing | Check `/etc/cron.d/alex` has trailing newline, owned by root |
| High token usage | Use `/tokens` and `/costs`, check model routing in logs |
| Control API 401 | Include `Authorization: Bearer <token>` header |
| Commands not in Telegram menu | Restart service — `setMyCommands` runs on startup |
| Kimi/DeepSeek not available | Check API key in config, restart Alex, check `/status` |
| Daily journal empty | Send a message first — files created on first exchange |
| ChromaDB Cloud fails | Falls back to local PersistentClient automatically |
| Local Redis down | Journal still works (writes to file), caching degrades gracefully |

---

## Quick Reference

```bash
npm start                              # Start gateway
npm run dev                            # Start with --watch
sudo systemctl restart alex            # Restart service
journalctl -u alex -f                  # Live logs
node --check src/*.js                  # Syntax check all source
npx vitest run                         # Run test suite (138 tests)
curl -X POST http://127.0.0.1:9090/api/trigger \
  -H 'Content-Type: application/json' \
  -d '{"task":"morning-briefing"}'     # Trigger a task manually
```

---

## License

MIT — Built by [NAVADA](https://www.navada.space)

*Clone it. Change the identity. Deploy your own AI agent.*
