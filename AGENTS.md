# Repository Guidelines

## Project Structure

- `src/`: main Node.js agent runtime (Telegram bot, control API, scheduled task runner).
- `Alex-Scripts/`: Python helpers (RAG, charts, scraping utilities) invoked by tools/tasks.
- `Alex-CLI/`: local CLI utilities.
- `deploy/oci/crontab`: container cron schedule used by `Dockerfile` to run heartbeat tasks 24/7.
- `dashboard-vercel/`: Vercel dashboard (API routes + static UI) that reads live state from Alex.
- `tests/`: test assets and scripts (if present, keep runnable in CI/local).
- `Manager/`: ops notes and runbooks (do not store secrets).

## Build, Test, and Development Commands

- `npm ci`: install dependencies exactly from `package-lock.json`.
- `npm run start`: start Alex locally (expects env vars like `TELEGRAM_BOT_TOKEN`, `ALEX_PORT`).
- `npm test`: run the project test suite (add tests here when fixing bugs).

Container build:

- `docker build -t alex .`: builds the Railway/OCI image (requires `deploy/oci/crontab`).

## Coding Style & Naming

- JavaScript (ESM): prefer `async/await`, avoid throwing from background loops (watchdogs/cron).
- Indentation: 4 spaces (match existing code).
- Filenames: kebab-case for utilities (e.g. `connectivity-watchdog.js`).
- Logging: never print secrets; log node statuses and high-level outcomes only.

## Testing Guidelines

- Add a focused regression test when fixing production crashes.
- Prefer small smoke checks for deployments:
  - `GET /api/health`
  - `GET /api/e2e`
  - `GET /api/dashboard/data`

## Commit & Pull Request Guidelines

- Commit messages: short, imperative, scoped (e.g. `Fix watchdog regex syntax`).
- Keep PRs small and describe:
  - What changed
  - How to validate (commands/endpoints)
  - Any new env vars (document in `README.md`)

## Security & Configuration

- Secrets must be set via Railway/Vercel environment variables, never committed.
- Optional hardening:
  - `DASHBOARD_READ_TOKEN` to protect `/api/dashboard/*`
  - `DASHBOARD_ALLOWED_ORIGINS` to restrict CORS for dashboard reads

