# ALEX — Future Improvements

## Context & Memory

### Improve Context Retention for Long Conversations
**Priority:** Medium
**Added:** 2026-02-04

**Issue:** When conversations exceed 8 messages, older messages are summarized by Haiku. This can lose important details like email recipients, specific instructions, or action items.

**Current behaviour:**
- `RECENT_WINDOW = 8` messages kept verbatim
- Older messages summarized to max 600 words
- Each message truncated to 300 chars before summarization
- Affects ALL models (Claude, Kimi, DeepSeek, GPT)

**Potential fixes:**
1. Increase `RECENT_WINDOW` to 12-16 for models with large context (Kimi 128K, Claude 200K)
2. Improve summarization prompt to better capture:
   - Recipient lists (email addresses, names)
   - Action items and specific instructions
   - Numbers, dates, and proper nouns
3. Skip summarization entirely for Kimi K2 (128K context) and send full conversation
4. Add "important context" extraction before summarization

**Location:** `src/chat.js:501` (`RECENT_WINDOW`), `src/chat.js:517` (`summarizeOlderMessages`)

---

## Scrapers

### Add More Apify Scrapers
**Priority:** Low
**Added:** 2026-02-04

Potential scrapers to add to `src/apify-scrapers.js`:
- Google Maps / Places scraper
- Amazon product scraper
- Twitter/X scraper
- YouTube scraper
- News article scraper

---
