# NAVADA AI Agent Framework

A production-ready autonomous AI agent that runs 24/7 on a Raspberry Pi 5. Originally built as **ALEX**, the Global Economist at NAVADA — but designed to be cloned and re-personalised into any AI agent role.

## What It Does

Your agent operates via Telegram as a persistent AI colleague that can:

| Capability | Description |
|------------|-------------|
| **Research** | Web search, market analysis, data gathering |
| **System Access** | Full terminal, file management, code execution |
| **Memory** | Persistent memory across all conversations with rolling summaries |
| **Email** | Draft and send HTML emails with attachments via Gmail |
| **PDF Reports** | Styled PDF reports with tables, charts, and branding (via reportlab) |
| **Voice** | Receive voice notes (Whisper transcription) and send voice responses (TTS) |
| **Charts** | Generate interactive charts and visualisations (via Plotly) |
| **Scheduling** | Cron-based tasks, reminders, recurring jobs |
| **Skills** | Extensible plugin system — agent can create its own tools |
| **Proactive** | Morning briefings, research updates, evening summaries (8 daily heartbeats) |
| **Smart Routing** | Haiku for simple queries, Sonnet for complex tasks, DeepSeek for deep research |
| **RAG** | ChromaDB vector search over knowledge base for relevant context |
| **Dashboard** | Live dashboard deployed on Vercel with real-time metrics |
| **Token Logging** | Per-call token tracking with daily usage stats and cost breakdown |
| **File Understanding** | Accepts photos, PDFs, and documents via Telegram with multimodal analysis |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Agent Gateway                         │
│                      (src/gateway.js)                        │
├──────────┬──────────┬──────────┬──────────┬────────────────┤
│ Telegram │  Memory  │  Skills  │  System  │    Request     │
│   Bot    │  System  │  System  │   Cron   │     Queue      │
├──────────┴──────────┴──────────┴──────────┴────────────────┤
│         Claude API (Sonnet 4 / Haiku 3.5 / DeepSeek)       │
│        OpenAI (Whisper STT / TTS) + Web Search + Tools     │
├────────────────────┬───────────────────────────────────────┤
│  ChromaDB (RAG)    │  reportlab (PDF) + Plotly (Charts)    │
├────────────────────┴───────────────────────────────────────┤
│                    Raspberry Pi 5 (8GB)                      │
│         24/7 systemd service + system cron scheduling       │
├─────────────────────────────────────────────────────────────┤
│    Dashboard: Local Python server → Vercel + Upstash Redis  │
└─────────────────────────────────────────────────────────────┘
```

### Message Flow

```
Telegram message → gateway.js (dedup + auth)
  → downloads photos/docs/voice as content blocks
  → voice notes: saved to ~/.alex/voice/ + Whisper transcription
  → chat.js chat() → selectModel() routes to Haiku/Sonnet/DeepSeek/GPT-4o
  → buildSystemPrompt() includes identity, memory, RAG context
  → prepareMessages() summarizes old messages, keeps last 8 verbatim
  → callAnthropicQueued() via queue.js (priority queue with circuit breaker)
  → processResponse() loops on tool_use blocks
    → tools.js executeTool() with dependency injection
  → smartSplit() response at paragraph boundaries → send via Telegram
```

### Model Routing

| Trigger | Model | Approx Cost/Call |
|---------|-------|-----------------|
| Greetings, status checks, short messages (<80 chars) | Haiku 3.5 | ~$0.002 |
| Research, analysis, reports, emails, tools | Sonnet 4 | ~$0.10 |
| "use deepseek", deep research, thorough analysis | DeepSeek | ~$0.001 |
| "use gpt", explicit GPT request | GPT-4o | ~$0.05 |

### Source Modules

| Module | Purpose |
|--------|---------|
| `src/gateway.js` | Entry point. Telegram bot, control API (port 9090), tool execution with dependency injection, startup catch-up for missed cron tasks |
| `src/chat.js` | Chat system factory. Model selection, token logging, conversation summarisation, API calls with retry |
| `src/tools.js` | Tool definitions array + `executeTool()` switch. All tools receive deps via object destructuring |
| `src/heartbeat.js` | Built-in task definitions map, scheduled task execution through AI, dashboard sync, cleanup |
| `src/memory.js` | `MemorySystem` class. Conversations, categories, identity, user info, rolling summaries |
| `src/skills.js` | `SkillsSystem` class. Skills stored as `~/.alex/skills/{name}/SKILL.md` |
| `src/config.js` | Config loader. Workspace paths, allowed write/attachment paths, path validation |
| `src/queue.js` | Priority request queue with circuit breaker, rate limiting, cooldown on 429s |

---

## Cloning This Agent (Creating a New AI)

This framework is designed for reuse. To create a new AI agent with a different personality and role:

### Step 1: Clone the Repository

```bash
git clone https://github.com/YOUR_USER/navada-1.git ~/my-agent
cd ~/my-agent
npm install
```

### Step 2: Install Python Dependencies

```bash
pip3 install --break-system-packages reportlab chromadb plotly kaleido
```

### Step 3: Create the Workspace

```bash
mkdir -p ~/.alex/{memory,conversations,skills,tasks,reports,research,data,logs,charts,images,uploads,voice,templates}
chmod 700 ~/.alex
```

### Step 4: Create Config (`~/.alex/config.json`)

```json
{
  "anthropic_api_key": "sk-ant-...",
  "telegram_bot_token": "BOT_TOKEN_FROM_BOTFATHER",
  "telegram_owner_id": YOUR_TELEGRAM_USER_ID,
  "telegram_authorized_users": [YOUR_TELEGRAM_USER_ID],
  "telegram_notify_tasks": true,
  "gmail_address": "your.email@gmail.com",
  "gmail_app_password": "xxxx xxxx xxxx xxxx",
  "recipient_email": "default@recipient.com",
  "openai_api_key": "sk-..."
}
```

Set permissions: `chmod 600 ~/.alex/config.json`

**How to get each key:**

| Key | Where to Get It |
|-----|----------------|
| `anthropic_api_key` | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `telegram_bot_token` | Telegram → @BotFather → /newbot |
| `telegram_owner_id` | Telegram → @userinfobot → send any message |
| `gmail_app_password` | Google Account → Security → 2FA → App Passwords |
| `openai_api_key` | [platform.openai.com](https://platform.openai.com) → API Keys (for voice/TTS) |

### Step 5: Define the Agent's Identity (`~/.alex/IDENTITY.md`)

This is the file that defines **who** your agent is. Change this to create a completely different AI:

```markdown
# Agent Name

You are [NAME], [ROLE] at [COMPANY].

## Personality
- [trait 1]
- [trait 2]

## Responsibilities
- [what the agent does]

## Communication Style
- [how it talks]
```

Example for ALEX:
```markdown
# ALEX

You are ALEX, the Global Economist at NAVADA.
You provide economic research, market analysis, and strategic intelligence.
```

Example for a different agent:
```markdown
# MAYA

You are MAYA, the Head of Engineering at Acme Corp.
You review code, manage deployments, and mentor the dev team.
```

### Step 6: Define User Info (`~/.alex/USER.md`)

```markdown
# User

- Name: [Your Name]
- Role: [Your Role]
- Preferences: [communication preferences]
```

### Step 7: Install the systemd Service

```bash
# Edit the service file to match your paths if needed
sudo cp navada-1.service /etc/systemd/system/alex.service
sudo systemctl daemon-reload
sudo systemctl enable alex
sudo systemctl start alex
```

The service file (`navada-1.service`):
- Runs as your user
- Auto-restarts on crash (`Restart=always`, `RestartSec=10`)
- Memory cap: 1GB, CPU cap: 80%
- Logs to `~/.alex/logs/gateway.log`

### Step 8: Install Cron Jobs

```bash
# Copy built-in heartbeat schedule
sudo cp cron/alex /etc/cron.d/alex
sudo cp cron/alex-tasks /etc/cron.d/alex-tasks
sudo chown root:root /etc/cron.d/alex*
```

Cron files **must** have a trailing newline and be owned by root.

Built-in schedule:

| Time | Task | Description |
|------|------|-------------|
| 3:00 AM | `cleanup` | Conversation memory pruning |
| 8:00 AM | `morning-briefing` | Overnight developments, agenda |
| 11:00 AM | `midmorning-checkin` | Proactive news scan |
| 1:00 PM | `midday-research` | Deep research session |
| 4:00 PM | `afternoon-checkin` | Afternoon news scan |
| 6:00 PM | `evening-summary` | Day recap, action items |
| Hourly | `dashboard-sync` | Metrics push to dashboard |
| Sun 10 PM | `weekly-self-review` | Weekly reflection |

Edit `cron/alex` to change the schedule, or ask the agent to create tasks via `schedule_task`.

### Step 9: Verify

```bash
sudo systemctl status alex          # Should show active (running)
journalctl -u alex -f               # Watch live logs
curl http://127.0.0.1:9090/api/users # Should return JSON
```

Send a message to your bot on Telegram — it should respond.

---

## Control API (Port 9090)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/command` | POST | Run a message through the chat system |
| `/api/send` | POST | Send a direct Telegram message to a user |
| `/api/trigger` | POST | Trigger a scheduled task by name |
| `/api/users` | GET | List known Telegram users |
| `/api/broadcast` | POST | Message all known users |

Examples:
```bash
# Trigger a task manually
curl -X POST http://127.0.0.1:9090/api/trigger \
  -H 'Content-Type: application/json' \
  -d '{"task":"morning-briefing"}'

# Send a message to a user
curl -X POST http://127.0.0.1:9090/api/send \
  -H 'Content-Type: application/json' \
  -d '{"userId":"123456789","message":"Hello from the API"}'
```

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/status` | System status (uptime, temp, memory, disk) |
| `/memory` | View memory summary |
| `/skills` | List available skills |
| `/tasks` | List scheduled tasks |
| `/tokens` | Daily token usage stats by model |
| `/clear` | Clear conversation history |
| `/help` | Show help |

## Dashboard

The agent includes a live dashboard system with two components:

### Local Dashboard Server
A Python server (`/home/head/clawd/dashboard/server.py`) on port 8080 that:
- Receives real-time updates from the agent (tasks, activity, news, metrics)
- Calculates token costs by model
- Tracks git commits
- Stores data in `dashboard_data.json`

### Vercel Dashboard
A serverless frontend (`/home/head/clawd/dashboard-vercel/`) deployed on Vercel:
- Static HTML dashboard fetching data from Upstash Redis
- API routes: `/api/data`, `/api/tokens`, `/api/commits`, `/api/push`
- Auto-refreshes every 15 seconds
- `push_to_vercel.sh` syncs local data to Vercel every 30 seconds via cron

To set up the Vercel dashboard for a clone:
1. Deploy `dashboard-vercel/` to Vercel
2. Create an Upstash Redis database and add env vars (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `PUSH_SECRET`)
3. Update `push_to_vercel.sh` with your Vercel URL and secret
4. Add cron entry: `* * * * * /path/to/push_to_vercel.sh`

## Workspace Layout

```
~/.alex/
├── config.json          # API keys (chmod 600)
├── IDENTITY.md          # Agent personality and role definition
├── USER.md              # User information
├── KNOWLEDGE.md         # Accumulated knowledge (auto-trimmed at 10,000 lines)
├── conversations/       # Per-chat JSON with messages + rolling summaries
├── memory/              # Categorized memory (user.md, projects.md, research.md, tasks.md)
├── skills/              # Skill plugins (SKILL.md per skill)
├── tasks/               # Scheduled task JSON definitions
├── templates/           # Email templates (signature.html, daily-summary.html)
├── uploads/             # Files received via Taildrop
├── voice/               # Saved voice notes (.ogg) + transcriptions (.txt)
├── reports/             # Generated PDF reports
├── charts/              # Generated Plotly charts
├── images/              # Generated images (DALL-E)
├── chromadb/            # RAG vector store
├── scripts/             # Utility scripts (generate_pdf.py, rag_manager.py)
├── research/            # Research outputs
├── data/                # Data files
└── logs/
    ├── gateway.log      # Main application log
    ├── tokens_*.jsonl   # Daily token usage (one file per day)
    ├── cron.log         # Cron job execution log
    └── .last-alive      # Heartbeat marker for missed-task catch-up
```

## Tools Available to the Agent

| Tool | Description |
|------|-------------|
| `bash` | Execute any shell command |
| `read_file` / `write_file` | Read and write files |
| `list_directory` | Browse filesystem |
| `web_search` | Search the internet |
| `memory_save` / `memory_recall` | Store and retrieve memories |
| `send_email` | Send emails via Gmail with attachments |
| `generate_pdf` | Create styled PDF reports |
| `generate_chart` | Create Plotly charts and visualisations |
| `generate_image` | Create images via DALL-E |
| `send_voice_message` | Text-to-speech voice notes via OpenAI TTS |
| `schedule_task` | Create cron-based scheduled jobs |
| `create_skill` | Build new agent capabilities |
| `update_dashboard` | Push updates to the live dashboard |

## Cron Resilience

Three layers ensure scheduled tasks never get lost:

1. **Curl retry** — All cron entries use `curl --retry 3 --retry-delay 30 --retry-connrefused` (~90s retry window)
2. **Startup catch-up** — `catchUpMissedTasks()` runs on boot, checks `.last-alive` marker, fires any tasks whose scheduled hour was missed during downtime
3. **systemd restart** — `Restart=always` with `RestartSec=10` auto-recovers from crashes

## Key Design Patterns

- **Dependency injection**: `executeTool()` receives all deps as a single object — never imports globals. When adding tools, add deps to `execToolWithDeps()` in gateway.js
- **Multimodal content**: `chat()` accepts string or array of Claude content blocks (text/image/document)
- **Token conservation**: System prompt includes skill names only (not full definitions), RAG top-3 chunks, rolling conversation summaries, last 8 messages verbatim
- **Queue priority**: User messages = priority 10, scheduled tasks = priority 1. Higher = processed first
- **Fire-and-forget dashboard**: Dashboard POSTs never block the main response flow

## Cost to Run

Based on real production data (Jan 2026):

| Component | Daily | Monthly | Annual |
|-----------|-------|---------|--------|
| API tokens (Claude + OpenAI) | ~£8 | ~£244 | ~£2,964 |
| Raspberry Pi electricity (12W) | £0.07 | £2.15 | £25.75 |
| **Total** | **~£8** | **~£246** | **~£2,990** |

For comparison, a human doing the same job costs ~£50,000/year (UK mid-level + employer NI/pension/overhead). The agent delivers **94% cost savings**.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Bot not responding | `sudo systemctl status alex` then `journalctl -u alex -f` |
| API errors | Check API key has credits, check `~/.alex/config.json`, check `/tokens` |
| Email not sending | Verify Gmail App Password (not regular password), ensure 2FA is on |
| PDF generation failing | `python3 -c "import reportlab; print('OK')"` — install if missing |
| Voice not working | Check `openai_api_key` is set in config. Check `~/.alex/voice/` for saved files |
| RAG/ChromaDB issues | `python3 -c "import chromadb; print('OK')"` — agent falls back gracefully if unavailable |
| Cron not firing | Check `/etc/cron.d/alex` has trailing newline, owned by root. Check `~/.alex/logs/cron.log` |
| Dashboard not updating | Check local server: `curl http://127.0.0.1:8080/`. Check `/tmp/vercel-push.log` |
| High token usage | Use `/tokens` in Telegram. Check Haiku is routing correctly in logs (`[MODEL]` entries) |
| Memory issues on Pi | `free -m` — clear old conversations if needed: `rm ~/.alex/conversations/*.json` |

## Quick Reference

```bash
# Start / stop / restart
sudo systemctl start alex
sudo systemctl stop alex
sudo systemctl restart alex

# View logs
journalctl -u alex -f
tail -f ~/.alex/logs/gateway.log

# Syntax check after code changes
node --check src/gateway.js src/chat.js src/tools.js src/heartbeat.js

# Manually trigger a task
curl -X POST http://127.0.0.1:9090/api/trigger \
  -H 'Content-Type: application/json' -d '{"task":"morning-briefing"}'

# Check today's token usage
cat ~/.alex/logs/tokens_$(date +%Y-%m-%d).jsonl | wc -l

# Deploy cron changes
sudo cp cron/alex /etc/cron.d/alex && sudo chown root:root /etc/cron.d/alex
```

## License

MIT License — Built for NAVADA

---

*Clone it. Change the identity. Deploy your own AI agent.*
