# ALEX Quick Start

## Your Setup
- **Pi Name:** headless
- **Pi Tailscale IP:** 100.71.230.23
- **Your iPhone:** 100.68.251.111

---

## Step 1: Create Telegram Bot (1 minute)

1. Open Telegram
2. Search for `@BotFather`
3. Send `/newbot`
4. Name: `ALEX`
5. Username: `alex_navada_bot` (or similar available name)
6. **Copy the token** (looks like `123456789:ABCdefGHI...`)

Also message `@userinfobot` to get your Telegram user ID.

---

## Step 2: SSH to Your Pi

Using Termius on iPhone or terminal on Mac:

```bash
ssh pi@100.71.230.23
```

---

## Step 3: Transfer & Install

```bash
cd ~/navada-1
npm install
npm run setup
```

---

## Step 4: Run Setup Wizard

The wizard will ask for:

1. **Anthropic API Key**
   - Get from: console.anthropic.com

2. **Telegram Bot Token**
   - From @BotFather (Step 1)

3. **Your Telegram User ID**
   - From @userinfobot

4. **Gmail Address**
   - Your sending email

5. **Gmail App Password**
   - myaccount.google.com → Security → 2FA → App Passwords

---

## Step 5: Start Chatting!

Once setup completes, open Telegram and message your bot.

Try these:
- "Hello, introduce yourself"
- "What can you do?"
- "Search for recent AI funding in Nigeria"
- "Create a file on the Pi with today's date"
- "Schedule a daily research task for 9am"

---

## Daily Proactive Briefings

ALEX automatically sends:

| Time | Briefing |
|------|----------|
| 8:00 AM | Morning overview |
| 1:00 PM | Midday research update |
| 6:00 PM | Evening summary |

---

## Useful Commands

### In Telegram
```
/start   - Welcome
/status  - System health
/memory  - What I remember
/skills  - My capabilities
/tasks   - Scheduled jobs
/clear   - Fresh start
```

### On Pi (SSH)
```bash
# Check status
sudo systemctl status alex

# View logs
tail -f ~/.alex/logs/gateway.log

# Restart
sudo systemctl restart alex

# Stop
sudo systemctl stop alex
```

---

## Example Conversations

**Research:**
> "Research the top 5 AI startups in Kenya that raised funding in 2025"

**File Management:**
> "Create a report about Ethiopian fintech and save it to ~/.alex/reports/"

**Memory:**
> "Remember that I'm meeting potential LPs on February 15th"
> "What do you remember about my upcoming meetings?"

**Scheduling:**
> "Schedule a task every Monday at 9am to summarize African tech news"

**Email:**
> "Draft an email to investors about our Q1 progress"

**System:**
> "What's the disk usage on this Pi?"
> "Install htop and show me the system load"

---

## Customization

Edit these files to customize ALEX:

| File | Purpose |
|------|---------|
| `~/.alex/IDENTITY.md` | Personality & role |
| `~/.alex/USER.md` | Info about you |
| `~/.alex/skills/*` | Add capabilities |
| `~/.alex/config.json` | API keys & settings |

---

## Costs

Estimated monthly:
- **Anthropic API**: $20-50 (depends on usage)
- **Raspberry Pi electricity**: ~$2

---

## Support

The agent is self-improving. Ask it to:
- "Create a skill for analyzing pitch decks"
- "Build a tool to track African startup news"
- "Make yourself better at financial analysis"

---

*ALEX: Your 24/7 AI economist*
