# Railway Nodes Snapshot (2026-02-14)

This snapshot records the working internal connectivity graph for the Railway deployment.
It intentionally avoids printing any secret values (API keys, tokens, DB URLs with passwords).

## Services (Railway Internal)
- Alex (control API): `http://127.0.0.1:9090/api/health`
- Chroma heartbeat: `http://chroma.railway.internal:8000/api/v2/heartbeat`
- NodeJS: `http://nodejs.railway.internal:3000/`
- HTTP NodeJS: `http://http-nodejs.railway.internal:8080/`
- AnythingLLM (internal): `http://anythingllm.railway.internal:3001/`
- Redis (TCP): `redis.railway.internal:6379` (or `REDIS_URL`)
- Postgres (TCP): `postgres.railway.internal:5432` (or `DATABASE_URL`)

## Expected Health Behaviors
- ALEX health is served from the control API on port `9090` in the Dockerfile build.
- If Telegram or node reachability appears to "disconnect", check for a container restart (SIGTERM) in Railway deploy logs.

## Stability Guardrails
- Connectivity transitions are logged to: `~/.alex/logs/connectivity-watchdog.log`
- Watchdog controls:
  - `CONNECTIVITY_WATCHDOG=0` disables probes
  - `CONNECTIVITY_WATCHDOG_INTERVAL_MS=60000` probe interval (default 60s)
  - `CONNECTIVITY_KEEPALIVE=0` disables self-keepalive

