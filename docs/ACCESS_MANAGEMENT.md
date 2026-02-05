# KEMET Automotive — Access Management

**Document Owner:** Lee Akpareva (NAVADA)
**Last Updated:** February 2026

---

## Access Tiers

### Tier 1: Owner (Lee)

**Telegram ID:** `6920669447`

| Category | Access |
|----------|--------|
| KEMET Data | Full read/write |
| /kemet Command | Full access |
| Send Emails to Nissi | Yes |
| Generate Reports | Yes |
| Modify PROJECT.md | Yes |
| Schedule KEMET Tasks | Yes |
| All 32 ALEX Tools | Yes |
| All Telegram Commands | Yes |
| Instruct ALEX Actions | Yes |

**Lee is the ONLY user who can instruct ALEX to take actions on behalf of KEMET.**

---

### Tier 2: KEMET Team (Nissi, Chopstix)

**Status:** Read-only query access

| User | Telegram ID | Status |
|------|-------------|--------|
| Nissi Ogulu | TBD | Pending — add to `KEMET_AUTHORIZED_USERS` |
| Malcolm "Chopstix" | TBD | Pending — add to `KEMET_AUTHORIZED_USERS` |

#### What They CAN Do

| Action | Allowed |
|--------|---------|
| `/kemet` | View project dashboard |
| `/kemet budget` | Query budget breakdown |
| `/kemet timeline` | Query project milestones |
| `/kemet team` | Query team structure |
| `/kemet [any question]` | Ask questions about project data |
| View GEZO specs | Yes |
| View cost analysis | Yes |
| View action items | Yes |

#### What They CANNOT Do

| Action | Blocked |
|--------|---------|
| Send emails on behalf of KEMET | No |
| Generate PDF reports | No |
| Modify project data | No |
| Schedule tasks | No |
| Access Pi filesystem | No |
| Run bash commands | No |
| Use any owner-only tools | No |
| Instruct ALEX to take actions | No |
| Access other client data | No |
| Access ALEX memory/knowledge | No |

---

### Tier 3: Authorized Users (General)

Users in `config.telegram_authorized_users` but NOT in KEMET team.

#### What They CAN Do

| Command/Tool | Access |
|--------------|--------|
| `/start` | Yes |
| `/help` | Yes |
| `/stocks AAPL` | Yes |
| `/news` | Yes |
| `/research topic` | Yes |
| `/brief` | Yes |
| `/tracked` | Yes |
| Chat with ALEX | Yes (limited tools) |
| `web_lookup` | Yes |
| `web_search` | Yes |
| `memory_recall` | Yes |
| `stock_quote` | Yes |
| `stock_search` | Yes |
| `company_overview` | Yes |
| `market_news` | Yes |
| `crypto_rate` | Yes |
| `economic_indicator` | Yes |
| `get_recent_uploads` | Yes |
| `generate_chart` | Yes |
| `generate_diagram` | Yes |
| `generate_mindmap` | Yes |

#### What They CANNOT Do

| Action | Blocked |
|--------|---------|
| `/kemet` | Access denied |
| Access any client data | No |
| Owner-only tools (see below) | No |

---

### Tier 4: Public/Unknown Users

Users NOT in any authorized list.

#### What They CAN Do

| Command | Access |
|---------|--------|
| `/start` | Yes |
| `/help` | Yes |
| `/stocks` | Yes |
| `/news` | Yes |
| `/research` | Yes |
| `/brief` | Yes |
| `/tracked` | Yes |

#### What They CANNOT Do

Everything else is blocked.

---

## Owner-Only Tools (Blocked for All Non-Owners)

These tools are restricted to Lee (owner) only:

| Tool | Purpose |
|------|---------|
| `bash` | Shell command execution |
| `read_file` | Read files from Pi |
| `write_file` | Write files to Pi |
| `edit_file` | Edit files on Pi |
| `list_directory` | List directory contents |
| `grep` | Search file contents |
| `glob` | Find files by pattern |
| `send_email` | Send emails via Gmail |
| `schedule_task` | Create scheduled tasks |
| `delete_task` | Delete scheduled tasks |
| `confirm_delete` | Confirm file deletion |
| `fetch_url` | Fetch URL content |
| `generate_pdf` | Generate PDF reports |
| `generate_image` | Generate images (DALL-E) |
| `create_skill` | Create new ALEX skills |
| `send_file` | Send files via Telegram |
| `send_voice_message` | Send voice messages |
| `update_dashboard` | Update dashboard state |
| `memory_save` | Save to ALEX memory |
| `manage_user` | Manage user access |
| `generate_webapp` | Generate web applications |
| `linkedin_post` | Post to LinkedIn |
| `calendar_*` | All calendar operations |
| `tiktok_scrape` | TikTok data scraping |
| `tiktok_download` | TikTok video download |
| `linkedin_posts_search` | LinkedIn search |
| `indeed_job_search` | Indeed job search |
| `google_maps_leads` | Google Maps lead scraping |

---

## KEMET-Specific Access Control

### Code Location

```javascript
// gateway.js (line ~89)
const KEMET_AUTHORIZED_USERS = new Set([
    '6920669447',   // Lee (owner)
    // Add Nissi's Telegram ID when known
    // Add Chopstix's Telegram ID when known
]);

function isKemetAuthorized(userId) {
    return KEMET_AUTHORIZED_USERS.has(String(userId));
}
```

### Adding New KEMET Users

1. Get the user's Telegram ID
2. Edit `src/gateway.js`
3. Add ID to `KEMET_AUTHORIZED_USERS` set
4. Restart ALEX: `sudo systemctl restart alex`

### Model Routing

All KEMET queries automatically use **Claude Opus 4.5** for maximum accuracy:

```javascript
// chat.js (line ~338)
if (/kemet|gezo|nissi|cotonou|benin.*automotive/i.test(msg)) {
    return 'claude-opus-4-5-20251101';
}
```

---

## Data Access Summary

| Data | Lee | Nissi/Chopstix | Other Users |
|------|-----|----------------|-------------|
| PROJECT.md | Read/Write | Read (via RAG) | None |
| Spreadsheet | Read/Write | None | None |
| Nissi's Email | Can send to | N/A | None |
| Weekly Reports | Generate | Receive | None |
| Budget Data | Full | Query only | None |
| Timeline | Full | Query only | None |
| Action Items | Modify | Query only | None |

---

## Security Notes

1. **All KEMET data is confidential** — unauthorized access returns "Access denied"
2. **Only Lee can instruct actions** — Nissi/Chopstix cannot trigger emails, reports, or modifications
3. **Opus model for accuracy** — ensures financial/technical data is handled precisely
4. **RAG isolation** — KEMET chunks are tagged with `client:Kemet_Automotive` source
5. **Audit logging** — all tool executions are logged to `~/.alex/logs/audit/`

---

## Contact for Access Issues

**Lee Akpareva** — lee@navada.info

Only Lee can authorize new users or modify access permissions.
