# ALEX Oracle Cloud Docker Deployment — Session Log

**Date:** 2026-02-07
**Status:** Phase 2 complete (Dockerfile + deploy scripts created). Ready for Phase 1 (OCI CLI setup) and Phase 3 (push + deploy).

---

## What Was Done

### File Modified
- **`src/gateway.js`** (lines 4287, 4747-4749) — Port and bind host now configurable via `ALEX_PORT` and `ALEX_BIND_HOST` environment variables. Defaults to `9090` and `127.0.0.1` so Pi behaviour is unchanged.

### Files Created

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build: `node:22-bookworm-slim` builder for `npm ci`, runtime with Python venv (matplotlib, chromadb, scipy, etc.), system deps (poppler-utils, tesseract-ocr, chromium, cron, fonts-liberation). Health check on `/api/health`. Entrypoint: `cron && exec node src/gateway.js` |
| `.dockerignore` | Excludes node_modules, .git, tests, logs, uploads, Manager/, dashboard-vercel/, deploy/ |
| `deploy/oci/crontab` | All 14 heartbeat tasks adapted for container (no user column, logs to `/home/alex/.alex/logs/`) |
| `deploy/oci/docker-compose.yml` | ALEX + Redis 7 Alpine sidecar with persistent volumes (`alex-data`, `redis-data`) |
| `deploy/oci/deploy.sh` | Build, tag, push to OCIR, SSH pull + restart automation. Supports `--build-only`, `--push-only`, `--deploy-only` flags |
| `deploy/oci/cloud-init.sh` | OCI instance bootstrap: Docker CE install, firewall ports 9090/443, creates deployment directories |
| `deploy/oci/setup-infra.sh` | Full OCI CLI provisioning: VCN, Internet Gateway, route table, security list (ports 22/9090/443), public subnet, ARM A1 Flex instance (2 OCPU, 12GB RAM) |
| `deploy/oci/README.md` | Step-by-step deployment guide with all env vars documented |

### Verification
- `node --check src/gateway.js` — syntax OK
- `npx vitest run` — **151 tests passed**, 10 skipped (integration), 0 failures
- No git pushes made

---

## Architecture

```
Pi 5 (build machine)                    Oracle Cloud (eu-london-1)
├── docker build alex:latest ──push──►  OCIR (Container Registry)
│                                           │
│                                       ARM Ampere A1 VM (2 OCPU, 12GB)
│                                       ├── docker pull alex:latest
│                                       ├── ALEX container (gateway.js)
│                                       ├── Redis container (sidecar)
│                                       └── Volume: ~/.alex/ data
```

---

## Next Steps

1. **Phase 1:** Install OCI CLI on Pi (`oci setup config`), upload API key to OCI Console
2. **Phase 1:** Run `setup-infra.sh` to provision VCN + ARM A1 instance
3. **Phase 2.7:** Build and test Docker image locally on Pi (`docker build -t alex:latest .`)
4. **Phase 3.1:** Create second Telegram bot via @BotFather (separate token for cloud)
5. **Phase 3.2:** Create cloud config with new bot token
6. **Phase 3.3:** Push image to OCIR, deploy with `deploy.sh`
7. **Phase 4 (future):** Oracle Autonomous DB integration (separate task)

---

## Ralph Self-Improvement Review

**Last run:** 2026-02-06 at 21:00 UTC — **Succeeded**
**Review saved to:** `~/.alex/fixes/2026-02-06-2100-review.md`

### Ralph's Findings (2026-02-06)

**Issues Found:**
- Multiple redundant boot log entries (same timestamp repeated twice)
- Potential system instability suggested by frequent reboots

**Proposed Fixes:**
1. **Boot Log Deduplication** — Filter duplicate log entries to reduce noise and storage waste
2. **Reboot Diagnostics** — Add detailed error tracking for system restart root causes
3. **Heartbeat Consistency Check** — Review scheduled tasks for non-overlapping execution to avoid scheduling conflicts

**Overall Health:** ALEX functionally stable, completing core tasks consistently. Boot log duplications warrant investigation.

---

## What Ralph Is

Ralph (`src/ralph.js`) is ALEX's self-improvement engine:
- Runs daily at 9 PM via `ralph-review` heartbeat task
- Reads diary entries + user feedback (last 7 days)
- Uses Haiku to identify failures, patterns, and improvement areas
- Proposes up to 3 concrete fixes per cycle
- Saves reviews to `~/.alex/fixes/{date}-{time}-review.md`
- Logs summary to diary
- Does NOT modify code — proposes only, humans approve
