# ALEX — Changelog

## 2026-02-16 — `v3.8.0` Full System Overhaul

**Type:** Enhancement

- PWA "Add to Home Screen" support for alexnavada.xyz with service worker and offline caching
- Cookie consent popup with synthwave glassmorphic design
- Ralph self-improvement engine overhaul: history tracking, health scores, category-based issues, timeline view
- Dashboard Ralph section: stats pills, progress bar, health assessment, issues/fixes grids, review history timeline
- Owner (6920669447) now has full unrestricted system access — no path or command restrictions
- Fixed 409 Telegram polling conflict (duplicate bot instances)
- Fixed /fixes command (missing CHANGELOG.md)
- Service worker: cache-first for static assets, network-first for API calls

## 2026-02-08 — `v3.7.0` Scraper Suite

**Type:** Feature

- Google Maps lead scraper (/leads command)
- Glassdoor company scraper (/glassdoor command)
- LinkedIn profiles search (/linkedinprofiles command)
- Indeed job search (/indeed command)
- All scrapers use Apify API with cost tracking

## 2026-02-06 — `v3.6.0` Ralph Self-Improvement Engine

**Type:** Feature

- Ralph daily review system — analyzes diary + feedback, proposes fixes
- Structured JSON output with issue categories and health scoring
- Review history stored in ralph-history.json (last 30 reviews)
- Dashboard card showing latest Ralph review status

## 2026-02-04 — `v3.5.0` TikTok & LinkedIn

**Type:** Feature

- TikTok scraper tool + /tiktok command via Apify
- LinkedIn posts search + /linkedinposts command
- Apify actor integration with cost attribution
- /scrapers command to list all available scrapers

## 2026-02-02 — `v3.4.0` Email Filing & Calendar

**Type:** Feature

- Gmail inbox monitoring with AI-powered categorisation
- Email filing system with status tracking (not_started, in_progress, done)
- /inbox, /email, /action commands for email management
- Google Calendar integration (/googlecalendar command)
- Email templates with professional signatures

## 2026-02-01 — `v3.3.0` 25 System Improvements

**Type:** Enhancement

- Rate limiting and CORS hardening
- Tool output truncation (500KB cap)
- Bash command blocklist for safety
- Circuit breakers for DeepSeek and OpenAI fallback
- Keyword index for memory recall fallback
- Auto-fact extraction from heartbeat outputs
- Content cache with 3-day TTL
- Graceful shutdown handler
- Enhanced morning briefing with market data
- Stock alerts and deadline follow-ups
- Idle conversation starters
- Full test suite (136 unit + e2e tests)

## 2026-01-31 — `v3.2.0` RAG Pipeline

**Type:** Feature

- Tailscale upload to RAG pipeline (OCR, text extraction, ChromaDB indexing)
- LESLIE marker splitting for permanent vs temporary content
- PDF, DOCX, XLSX, image support
- ChromaDB cloud integration
- /cleanup removes expired TTL entries

## 2026-01-30 — `v3.1.0` Futuristic Dashboard

**Type:** Feature

- 30 futuristic API endpoints on Vercel
- 7-day Redis cache for heavy endpoints
- API key system with email and expiry
- FUTURE_ECONOMIST persona for market analysis
- Dashboard real-time polling every 5 seconds
