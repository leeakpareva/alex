# ALEX - Global Economist at NAVADA VC

A full-featured AI agent that runs 24/7 on your Raspberry Pi, serving as the Global Economist for NAVADA VC.

## What It Does

ALEX is your AI economist colleague that can:

| Capability | Description |
|------------|-------------|
| **Research** | Web search, market analysis, startup due diligence |
| **System Access** | Full terminal access, file management, code execution |
| **Memory** | Remembers everything across all conversations (500 messages on disk, last 20 sent to API) |
| **Email** | Draft and send emails with auto-CC to lee@navada.info and file attachment support |
| **PDF Reports** | Generate styled PDF reports with tables, sections, and headings (via reportlab) |
| **Scheduling** | Create tasks, reminders, recurring jobs |
| **Skills** | Extensible plugin system, can create its own tools |
| **Proactive** | Morning briefings, research updates, evening summaries (5 daily heartbeats) |
| **Smart Routing** | Uses Haiku for simple queries, Sonnet for complex tasks — 80% cheaper on greetings |
| **RAG** | ChromaDB vector search over knowledge base and skills for relevant context retrieval |
| **Token Logging** | Per-call token tracking with `/tokens` command for daily usage stats |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      ALEX Gateway                        │
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│ Telegram │  Memory  │  Skills  │   Cron   │   Request   │
│   Bot    │  System  │  System  │ Scheduler│    Queue    │
├──────────┴──────────┴──────────┴──────────┴─────────────┤
│              Claude API (Sonnet 4 / Haiku 4)            │
│           Web Search + Tools + Model Selection          │
├──────────────────────┬──────────────────────────────────┤
│   ChromaDB (RAG)     │   reportlab (PDF Generation)    │
├──────────────────────┴──────────────────────────────────┤
│                   Raspberry Pi 5                         │
│        (Full system access: bash, files, network)       │
└─────────────────────────────────────────────────────────┘
```

### Token Optimization Pipeline

```
User message
    │
    ├─► selectModel() ─── simple greeting? → Haiku ($0.0015)
    │                 ─── complex task?    → Sonnet ($0.096)
    │
    ├─► buildSystemPrompt(userQuery)
    │       ├── Identity + User memory (always included)
    │       ├── RAG query → top 3 relevant chunks (not full knowledge dump)
    │       └── Skill names only (not full SKILL.md content)
    │
    ├─► Conversation: send last 20 messages (not all 500)
    │
    ├─► RequestQueue: 1s min between calls, 60s cooldown on 429
    │       └── User priority 10, background tasks priority 1
    │
    └─► System prompt cached per request (not rebuilt per tool call)

Result: ~32k input tokens → ~5-8k per call
```

## Quick Start

### Prerequisites

- Raspberry Pi 5 (8GB RAM recommended)
- Node.js 22+
- Python 3.13+ with reportlab (`pip3 install reportlab`)
- ChromaDB (`pip3 install --break-system-packages chromadb`)
- Anthropic API key
- Telegram account

### Installation

```bash
# Clone the repository
cd ~/navada-1

# Install Node dependencies
npm install

# Install Python dependencies
pip3 install --break-system-packages reportlab chromadb

# Run setup wizard
npm run setup
```

The setup wizard will guide you through:
1. Anthropic API key configuration
2. Telegram bot creation
3. Gmail setup for sending emails
4. System service installation

### Manual Configuration

If you prefer manual setup, create `~/.alex/config.json`:

```json
{
  "anthropic_api_key": "sk-ant-...",
  "telegram_bot_token": "123456789:ABC...",
  "telegram_owner_id": 123456789,
  "telegram_authorized_users": [123456789],
  "telegram_notify_tasks": true,
  "gmail_address": "your.email@gmail.com",
  "gmail_app_password": "xxxx xxxx xxxx xxxx",
  "recipient_email": "lee@navada.info"
}
```

## Usage

### Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and overview |
| `/status` | System status (uptime, temp, memory) |
| `/memory` | View memory summary |
| `/skills` | List available skills |
| `/tasks` | List scheduled tasks |
| `/tokens` | Daily token usage stats (by model) |
| `/clear` | Clear conversation history |
| `/help` | Show help message |

### Natural Language

Just message ALEX naturally:

- "Research the latest AI funding rounds in Africa"
- "Create a PDF report on Nigerian fintech startups"
- "Generate a report and email it to investor@example.com"
- "Schedule a daily research task for 9am"
- "Remember that our next board meeting is Feb 15"
- "Draft an email to potential LP about our fund"
- "What do you remember about Project Alpha?"

### CLI Commands

```bash
alex start       # Start in foreground
alex status      # Check service status
alex restart     # Restart service
alex stop        # Stop service
alex logs        # View logs
alex logs -f     # Follow logs
alex config      # Show configuration
alex memory      # List memory categories
alex skills      # List installed skills
alex tasks       # List scheduled tasks
```

## Features

### Email System

All emails are automatically CC'd to `lee@navada.info`. Emails support file attachments — use with `generate_pdf` to create and email reports in one workflow.

### PDF Report Generation

ALEX can generate styled PDF reports using the `generate_pdf` tool:

- Professional styling with NAVADA VC branding
- Sections with headings, paragraph content, and data tables
- Alternating row colors, styled headers
- Custom title, subtitle, and footer
- Output saved to `~/.alex/reports/`

**Workflow:** Ask ALEX to generate a report and email it:
```
"Create a PDF report on Q1 AI funding trends and email it to investor@example.com"
```
ALEX will: generate PDF → get file path → send email with attachment + auto-CC.

**Script:** `~/.alex/scripts/generate_pdf.py` (uses reportlab)

### Smart Model Selection

ALEX automatically routes requests to the cheapest appropriate model:

| Pattern | Model | Cost |
|---------|-------|------|
| Greetings, status checks, simple replies | Haiku 4 | ~$0.0015/call |
| Research, analysis, reports, strategy | Sonnet 4 | ~$0.096/call |

### RAG Context Retrieval (ChromaDB)

Instead of stuffing the entire knowledge base and all skill definitions into every prompt, ALEX uses vector search:

1. On startup, indexes all knowledge, skills, identity, and user memory into ChromaDB
2. On each user message, queries for the top 3 most relevant chunks
3. Only those chunks are included in the system prompt
4. Falls back to truncated knowledge (2000 chars) + skill names if RAG is unavailable
5. Auto-reindexes when knowledge or skills change

**Script:** `~/.alex/scripts/rag_manager.py`

### Request Queue

All API calls go through a priority queue:

- **User messages:** Priority 10 (never blocked by background tasks)
- **Heartbeats/scheduled tasks:** Priority 1
- **Rate limit handling:** On 429, enters 60s cooldown — requests queue silently and retry
- **Minimum interval:** 1s between API calls

### Token Usage Logging

Every API call is logged to `~/.alex/logs/tokens_YYYY-MM-DD.jsonl`:

```json
{"timestamp":"2026-01-30T19:00:00.000Z","model":"claude-sonnet-4-20250514","input_tokens":5200,"output_tokens":800}
```

Use `/tokens` in Telegram to see daily stats broken down by model.

### Memory System

ALEX maintains persistent memory across all conversations:

- **User Memory** (`~/.alex/USER.md`) - Information about you
- **Knowledge Base** (`~/.alex/KNOWLEDGE.md`) - Learned facts (auto-trimmed at 10,000 lines)
- **Category Memory** (`~/.alex/memory/*.md`) - Organized by topic
- **Conversations** (`~/.alex/conversations/*.json`) - Chat history (500 messages stored, last 20 sent to API)

Ask ALEX to remember things:
- "Remember that I prefer concise reports"
- "Save this research to the Africa category"
- "What do you know about my investment preferences?"

### Skills System

Skills extend ALEX's capabilities. Built-in skills:

| Skill | Purpose |
|-------|---------|
| `economic-research` | Market and economic analysis |
| `web-browsing` | Web research and data gathering |
| `file-management` | File operations and organization |
| `code-execution` | Running scripts and automation |
| `email-drafting` | Professional email composition |
| `calendar-management` | Scheduling and reminders |
| `startup-analysis` | Due diligence framework |

Create custom skills:
```
"Create a skill for analyzing pitch decks"
```

Skills are stored in `~/.alex/skills/<name>/SKILL.md`

### Scheduled Tasks & Heartbeats

ALEX runs 5 proactive daily tasks:

| Time | Task | Description |
|------|------|-------------|
| 8:00 AM | Morning briefing | Overnight developments, market movements, today's agenda |
| 11:00 AM | Proactive scan | Breaking news check (notify only if noteworthy) |
| 1:00 PM | Midday research | AI/robotics funding, African tech, economic indicators |
| 4:00 PM | Proactive scan | Afternoon breaking news check |
| 6:00 PM | Evening summary | Day recap, action items, strategic reflection |

**Custom Tasks:**
```
"Schedule a daily task at 10am to check for new AI funding announcements"
"Create a weekly task on Mondays to summarize African tech news"
```

Tasks are stored in `~/.alex/tasks/*.json`

### Tool Access

ALEX has full access to:

| Tool | Capabilities |
|------|--------------|
| `bash` | Execute any shell command |
| `read_file` | Read file contents |
| `write_file` | Create/modify files |
| `list_directory` | Browse filesystem |
| `web_search` | Search the internet |
| `memory_save` | Store information |
| `memory_recall` | Retrieve information |
| `send_email` | Send emails via Gmail (auto-CC lee@navada.info, supports attachments) |
| `generate_pdf` | Create styled PDF reports with tables and sections |
| `schedule_task` | Create scheduled jobs |
| `create_skill` | Build new capabilities |

## Directory Structure

```
~/.alex/
├── config.json           # Configuration (API keys, etc.)
├── IDENTITY.md           # ALEX's identity and personality
├── USER.md               # Information about you
├── KNOWLEDGE.md          # Learned knowledge base (auto-trimmed)
├── chromadb/             # ChromaDB vector store for RAG
├── memory/               # Categorized memories
│   ├── user.md
│   ├── projects.md
│   ├── research.md
│   └── tasks.md
├── conversations/        # Chat history by ID
├── skills/               # Installed skills
│   ├── economic-research/
│   ├── startup-analysis/
│   └── ...
├── tasks/                # Scheduled task definitions
├── scripts/              # Utility scripts
│   ├── generate_pdf.py   # PDF report generator (reportlab)
│   └── rag_manager.py    # ChromaDB index/query manager
├── reports/              # Generated PDF reports
├── research/             # Research outputs
├── data/                 # Data files
└── logs/                 # Application logs
    ├── gateway.log       # Main application log
    └── tokens_*.jsonl    # Daily token usage logs
```

## Performance

| Metric | Before | After |
|--------|--------|-------|
| Input tokens/call | ~32,000 | ~5,000-8,000 |
| API calls/day (heartbeats) | ~13 | 5 |
| Rate limit UX | Error messages shown | Queued + retried silently |
| Simple query cost | $0.096 (Sonnet) | $0.0015 (Haiku) |
| Email CC | None | Always lee@navada.info |
| PDF reports | Not possible | Full support + email attachment |

## Service Management

ALEX runs as a systemd service:

```bash
# Status
sudo systemctl status alex

# Start/Stop/Restart
sudo systemctl start alex
sudo systemctl stop alex
sudo systemctl restart alex

# Enable/Disable auto-start
sudo systemctl enable alex
sudo systemctl disable alex

# View logs
journalctl -u alex -f
# or
tail -f ~/.alex/logs/gateway.log
```

## Security Considerations

ALEX has full system access. This is powerful but requires care:

1. **API Key Security**: Keep `config.json` permissions restricted (600)
2. **Telegram Authorization**: Only allow your user ID
3. **Network**: Consider using Tailscale for secure remote access
4. **Backups**: Important data should be backed up regularly

## Customization

### Identity

Edit `~/.alex/IDENTITY.md` to customize ALEX's personality and role.

### Skills

Create new skills in `~/.alex/skills/<name>/SKILL.md`:

```markdown
# My Custom Skill

## Purpose
What this skill does.

## Capabilities
- Capability 1
- Capability 2

## Usage
How to use this skill.
```

### Scheduled Tasks

Create tasks in `~/.alex/tasks/<name>.json`:

```json
{
  "name": "my-task",
  "cron_expression": "0 9 * * *",
  "task_description": "What to do when this runs"
}
```

## Troubleshooting

### Bot not responding
```bash
sudo systemctl status alex
tail -50 ~/.alex/logs/gateway.log
```

### API errors
- Check your Anthropic API key has credits
- Verify the key in `~/.alex/config.json`
- Check `/tokens` for usage stats — may be hitting rate limits

### Email not sending
- Verify Gmail App Password (not regular password)
- Check 2FA is enabled on Gmail account
- Test: `node ~/.alex/scripts/send_email.js test@email.com "Test" "Body"`

### PDF generation failing
- Verify reportlab is installed: `python3 -c "import reportlab; print('OK')"`
- Install if missing: `pip3 install --break-system-packages reportlab`

### RAG/ChromaDB issues
- Check if installed: `python3 -c "import chromadb; print('OK')"`
- Re-index manually: `python3 ~/.alex/scripts/rag_manager.py index`
- ALEX falls back gracefully if ChromaDB is unavailable

### High token usage
- Check `/tokens` for daily breakdown
- Verify Haiku is being used for simple queries (check `[MODEL]` entries in logs)
- Clear old conversation history: `/clear`

### Memory issues on Pi
```bash
# Check memory usage
free -m

# Clear conversation history if needed
rm ~/.alex/conversations/*.json
```

## License

MIT License - Built for NAVADA VC

---

*ALEX: Your AI economist, always on duty.*
