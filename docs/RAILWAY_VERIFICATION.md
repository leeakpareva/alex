# Railway Node Verification Guide

## Overview
This guide provides safe methods to verify all Railway nodes are connected and working with Alex without disrupting the service.

## Service Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Alex Main Service                    │
│                  (71e94c37-64c6-44f2...)                │
│                        Port: 9090                        │
└────────────────────┬─────────────────────────────────────┘
                     │
     ┌───────────────┼───────────────┬────────────────┐
     ▼               ▼               ▼                ▼
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐
│ Postgres │  │ ChromaDB │  │  Node.js │  │ Upstash Redis│
│(18f45778.│  │(be536d17.│  │(61c90c33.│  │ (e37177e0...)│
│   ...)   │  │   ...)   │  │   ...)   │  │   (Managed)  │
└──────────┘  └──────────┘  └──────────┘  └──────────────┘
```

## Quick Verification Methods

### 1. E2E Health Check (Recommended)
The safest and most comprehensive check:

```bash
# From any machine with access to Alex
curl http://<alex-railway-url>/api/e2e

# Or from within Railway
railway run --service=71e94c37-64c6-44f2-a5c8-7ae2a1b641f4 -- \
  curl -s http://127.0.0.1:9090/api/e2e | python3 -m json.tool
```

### 2. Telegram Bot Check
Send `/init` to the Alex Telegram bot. This runs a comprehensive E2E check and reports:
- Overall status
- Individual service health
- Response times
- Any failures

### 3. Using Verification Scripts

#### Node.js Script (Cross-platform)
```bash
cd Alex_Railway
node scripts/check_railway_connectivity.js
```

#### PowerShell Script (Windows)
```powershell
cd Alex_Railway
.\scripts\check_railway_nodes.ps1
```

#### Bash Script (Linux/Mac)
```bash
cd Alex_Railway
bash scripts/verify_all_nodes.sh
```

## Service-Specific Checks

### Alex Main (71e94c37-64c6-44f2-a5c8-7ae2a1b641f4)
```bash
# Check health
railway run --service=71e94c37-64c6-44f2-a5c8-7ae2a1b641f4 -- \
  curl http://127.0.0.1:9090/api/health

# Check logs
railway logs --service=71e94c37-64c6-44f2-a5c8-7ae2a1b641f4 --limit=50
```

### PostgreSQL (18f45778-a301-48ae-bc1d-4b8a24c7a246)
```bash
# Check if tables exist
railway run --service=18f45778-a301-48ae-bc1d-4b8a24c7a246 -- \
  psql -U postgres -d railway -c "\dt"

# Check recent data
railway run --service=18f45778-a301-48ae-bc1d-4b8a24c7a246 -- \
  psql -U postgres -d railway -c "SELECT COUNT(*) FROM connectivity_events;"
```

### ChromaDB (be536d17-091f-49c3-a141-22efcd867dee)
```bash
# Check heartbeat
railway run --service=be536d17-091f-49c3-a141-22efcd867dee -- \
  curl http://localhost:8000/api/v2/heartbeat
```

### Upstash Redis (e37177e0-e16b-4fbf-b95c-4b8ca8b37ae4)
This is a managed service. Check from Alex:
```bash
railway run --service=71e94c37-64c6-44f2-a5c8-7ae2a1b641f4 -- \
  node -e "
    const { Redis } = require('@upstash/redis');
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN
    });
    redis.ping().then(console.log).catch(console.error);
  "
```

## What the E2E Check Verifies

The `/api/e2e` endpoint checks:

1. **Alex Health** - Main service status
2. **ChromaDB Heartbeat** - RAG database connectivity
3. **Dashboard Data** - Redis data flow
4. **Node.js Services** - Supporting services
5. **Postgres** - Data persistence (if DATABASE_URL is set)

## Understanding Results

### Successful E2E Response
```json
{
  "ok": true,
  "ts": "2024-02-14T10:00:00Z",
  "checks": {
    "alex_health": { "ok": true, "status": 200, "ms": 5 },
    "chroma_heartbeat": { "ok": true, "status": 200, "ms": 45 },
    "dashboard_data": { "ok": true, "status": 200, "ms": 12 },
    "nodejs": { "ok": true, "status": 200, "ms": 23 },
    "http_nodejs": { "ok": true, "status": 200, "ms": 18 }
  }
}
```

### Partial Failure
Alex continues working even if non-critical services fail:
- ChromaDB down → RAG features degraded, but Alex works
- Node.js services down → Some features unavailable
- Upstash down → Dashboard updates delayed

### Critical Failures
These require immediate attention:
- Alex main service down
- PostgreSQL down (if configured)
- Telegram bot disconnected

## Troubleshooting

### Check Environment Variables
```bash
railway variables --service=71e94c37-64c6-44f2-a5c8-7ae2a1b641f4
```

Required variables:
- `DATABASE_URL` - PostgreSQL connection
- `TELEGRAM_BOT_TOKEN` - Telegram bot
- `ANTHROPIC_API_KEY` - Claude API
- `UPSTASH_REDIS_REST_URL` - Redis URL
- `UPSTASH_REDIS_REST_TOKEN` - Redis token

### View Service Logs
```bash
# View all service logs
for service in 71e94c37 18f45778 be536d17 61c90c33 7758afc6; do
  echo "=== Service ${service:0:8} ==="
  railway logs --service=$service* --limit=20 | grep -E "error|connected|ready"
done
```

### Restart a Service
```bash
railway restart --service=<service-id>
```

## Important Notes

1. **Never directly modify production data** without backups
2. **E2E checks are read-only** and safe to run frequently
3. **Service logs auto-rotate** - check promptly for issues
4. **Non-critical services** can be down without breaking Alex
5. **Use Telegram /init** for user-friendly status checks

## Monitoring Best Practices

1. Run E2E check every 5 minutes via monitoring service
2. Set up alerts for critical service failures
3. Check dashboard at https://alexnavada.xyz for real-time status
4. Review daily ops report email for trends
5. Monitor Postgres data growth and clean old records monthly

## Recovery Procedures

If Alex is completely down:

1. Check Railway dashboard for deployment status
2. Verify environment variables are set
3. Check recent deployments for breaking changes
4. Restart services in order:
   - Postgres first
   - Redis/Upstash second
   - ChromaDB third
   - Alex main last
5. Monitor logs during restart
6. Run E2E check to verify recovery