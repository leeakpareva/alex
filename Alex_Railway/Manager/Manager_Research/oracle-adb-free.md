# Oracle Autonomous Database Free — Research Notes

**Date:** 2026-02-07
**Status:** Reviewed and parked
**Source:** https://github.com/oracle/adb-free

## What It Is

Oracle Autonomous Database Free is a self-contained database running in a Docker/Podman container. The 23ai/26ai versions include enterprise features — running entirely locally with zero cloud dependency or licence fees.

"Offline" means it runs 100% locally — no Oracle Cloud account, no internet required.

## Key Features

| Feature | Description |
|---------|-------------|
| AI Vector Search | Native `VECTOR` data type, similarity search via SQL |
| JSON Document Store | Native JSON storage with SQL queries |
| REST APIs (ORDS) | Built-in REST endpoints for any table/collection |
| MongoDB API | Wire-compatible Mongo protocol on port 27017 |
| APEX | Low-code web app builder |
| 20GB storage | Per database limit |

## System Requirements

- 4 CPUs and 8GB RAM minimum
- linux/arm64 supported on 23ai and 26ai versions
- Docker or Podman

## Potential Benefits for ALEX

- **Replace flat JSON files** — Conversations, memory, tasks, email filing are all JSON on disk with no indexing. A real database removes those limitations.
- **Replace ChromaDB** — Oracle's vector search is built-in, eliminating the separate Python/ChromaDB process for RAG.
- **Cross-data search** — SQL enables queries like "find all emails mentioning X from January" which flat files can't do.
- **Concurrent access** — Proper read/write handling vs JSON file locks.

## Why We're Not Using It

- **Pi 5 resources**: Requires 4 CPUs and 8GB RAM. Pi 5 has 8GB total — leaves almost nothing for ALEX, Node.js, ChromaDB.
- **Heavyweight**: Enterprise software crammed into a container. Massive overkill for current needs.
- **Operational complexity**: Oracle SQL, ORDS config, container management — significant overhead.
- **arm64 on 8GB**: Technically supported but extremely tight.

## Better Alternatives If We Need a Database Later

| Option | Pros | Cons |
|--------|------|------|
| **SQLite** | Zero config, single file, JSON + full-text search, perfect for Pi | No vector search built-in |
| **PostgreSQL + pgvector** | Real database with vector search, lighter than Oracle | Still needs a running process |
| **Upstash Redis (existing)** | Already in use, no new infra | Not a relational database |

## Decision

Parked. The problems it solves (flat files, fragile RAG) are real but don't yet justify the resource cost on an 8GB Pi. Revisit if ALEX moves to beefier hardware or if data volume outgrows flat files.
