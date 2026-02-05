# ALEX Access Management

> Security architecture for the ALEX agent system. Defines user tiers, tool permissions, and API access controls.

---

## User Tiers

### Tier 1: Owner (Full Access)

**Telegram User ID:** `6920669447`

- Unrestricted access to all 32 tools
- Full Pi filesystem access (bash, read/write/edit files)
- Email sending, scheduling, cost-incurring operations
- System administration commands

### Tier 2: Full Access Users

**Set:** `FULL_ACCESS_USERS` in `tools.js`

- Same permissions as owner
- Manually added by owner to the allowlist
- Intended for trusted team members

### Tier 3: Limited Users (Default)

**All other Telegram users**

- Access to safe, conversational tools only
- No filesystem, shell, email, or scheduling access
- No cost-incurring operations (DALL-E, etc.)

---

## Tool Permissions

### Owner-Only Tools (`tools.js:785`)

| Tool | Risk Level | Description |
|------|------------|-------------|
| `bash` | Critical | Shell command execution |
| `read_file` | High | Read any file on Pi |
| `write_file` | High | Write to allowed paths |
| `edit_file` | High | Modify existing files |
| `list_directory` | Medium | Directory listing |
| `grep` | Medium | Search file contents |
| `glob` | Medium | Find files by pattern |
| `send_email` | High | Send emails as ALEX |
| `schedule_task` | High | Create cron jobs |
| `delete_task` | High | Remove scheduled tasks |
| `confirm_delete` | Critical | File deletion (requires 3 confirmations + password) |
| `fetch_url` | Medium | HTTP requests to external URLs |
| `generate_pdf` | Medium | PDF generation |
| `generate_image` | Medium | DALL-E image generation (cost) |
| `create_skill` | High | Create new ALEX skills |
| `send_file` | Medium | Send files via Telegram |
| `send_voice_message` | Medium | TTS voice messages |
| `update_dashboard` | Medium | Modify dashboard state |
| `memory_save` | Medium | Write to persistent memory |
| `tiktok_scrape` | Medium | Apify TikTok scraper (cost) |

### Public Tools (All Users)

| Tool | Description |
|------|-------------|
| `web_lookup` | DuckDuckGo search |
| `web_search` | Web search with summaries |
| `memory_recall` | Read from memory (no write) |
| `stock_quote` | Real-time stock prices |
| `stock_search` | Search stock symbols |
| `company_overview` | Company fundamentals |
| `market_news` | Financial news |
| `crypto_rate` | Cryptocurrency rates |
| `economic_indicator` | Economic data |
| `get_recent_uploads` | List uploaded files |
| `generate_chart` | Python data visualisation |
| `generate_diagram` | Mermaid diagrams |
| `generate_mindmap` | Markmap mind maps |

---

## Permission Check Implementation

**Location:** `tools.js:817`

```javascript
if (OWNER_ONLY_TOOLS.has(name) && config.telegram_owner_id && callerUserId) {
    if (callerUserId !== config.telegram_owner_id && !FULL_ACCESS_USERS.has(callerUserId)) {
        return {
            success: false,
            error: `Permission denied: '${name}' is restricted to the account owner.`
        };
    }
}
```

The `callerUserId` is passed through dependency injection from `gateway.js:136`.

---

## API Access Control

### Control API (Port 9090)

**Location:** `gateway.js:1975`

| Endpoint | Auth Required | Description |
|----------|---------------|-------------|
| `POST /api/command` | API Key | Run chat command |
| `POST /api/send` | API Key | Send Telegram message |
| `POST /api/trigger` | API Key | Trigger scheduled task |
| `GET /api/users` | API Key | List known users |
| `POST /api/broadcast` | API Key | Message all users |
| `GET /health` | None | Health check |

**API Key:** Set in `~/.alex/config.json` as `api_key`. Passed via `X-API-Key` header.

### Rate Limiting

- **Per-IP:** 100 requests/minute
- **Global:** 1000 requests/minute
- **Implemented:** In-memory sliding window

---

## Delete Guardrail

**Location:** `tools.js:631`

The `bash` tool blocks destructive commands:
- `rm`, `rmdir`, `unlink`, `shred`

Deletion requires:
1. Use `confirm_delete` tool
2. Three sequential user confirmations
3. Password verification

---

## Sensitive Data Masking

**Location:** `tools.js:595`

`maskSensitive()` strips from all tool output:
- API keys and tokens
- Passwords
- OAuth secrets
- Private keys

---

## Telegram Command Restrictions

Some Telegram commands are owner-only:
- `/config` — View/modify config
- `/tokens` — Token usage stats
- `/broadcast` — Message all users

---

## Adding Full Access Users

To grant a user full access:

1. Get their Telegram user ID (visible in logs)
2. Add to `FULL_ACCESS_USERS` set in `tools.js`:

```javascript
const FULL_ACCESS_USERS = new Set([
    '1234567890',  // User name
]);
```

3. Restart ALEX: `sudo systemctl restart alex`

---

## Security Best Practices

1. **Never share the owner Telegram account**
2. **Rotate API keys periodically** (update `~/.alex/config.json`)
3. **Monitor audit logs** at `~/.alex/logs/audit.log`
4. **Review token usage** with `/tokens` command
5. **Keep config.json permissions** at `0600` (owner read/write only)

---

## Audit Logging

All actions are logged to `~/.alex/logs/audit.log`:
- User messages with user ID
- Tool executions with parameters
- Permission denials
- API requests

Log rotation: 30-day retention, handled by cleanup task.
