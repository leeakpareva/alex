# QR Click Tracking

Every scan of the ALEX QR code hits `alexnavada.xyz/qr`, which logs the click to Upstash Redis before redirecting.

## Files

| File | Purpose |
|------|---------|
| `clicks.json` | Full click history (JSON array) |
| `clicks.log` | Human-readable log (one line per click) |
| `sync-clicks.mjs` | Pulls new clicks from Redis to local files |

## Each click records

- **timestamp** — ISO 8601 UTC
- **destination** — where the user was redirected
- **user_agent** — browser/device info
- **ip** — visitor IP (from X-Forwarded-For)
- **referer** — referring page (if any)

## Sync

```bash
# Manual sync
node /home/head/ALEX_NAVADA/Manager/QR_/sync-clicks.mjs

# Automatic: runs every hour via ALEX heartbeat
```

## Flow

```
Phone scans QR → alexnavada.xyz/qr → api/qr.js logs to Redis → 302 redirect
                                          ↓
                        sync-clicks.mjs pulls from Redis → clicks.json + clicks.log
```
