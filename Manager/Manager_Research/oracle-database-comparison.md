# Oracle Database Free vs Oracle Cloud Always Free — Detailed Comparison for ALEX

**Date:** 2026-02-07
**Status:** Under review
**Purpose:** Evaluate both Oracle offerings for ALEX infrastructure — local Pi deployment vs cloud demo environment

---

## Side-by-Side Comparison

| | **Oracle DB Free (Local ARM)** | **Oracle Cloud Always Free (ADB)** |
|---|---|---|
| **Cost** | Free forever, no account needed | Free forever (Always Free tier) |
| **Where it runs** | Pi 5 locally (aarch64 RPM) | Oracle Cloud Infrastructure |
| **Version** | 26ai (latest) | 26ai (latest) |
| **CPU** | 2 foreground CPUs max | 1 OCPU (~2 vCPUs) |
| **RAM** | 2GB (SGA+PGA combined) | Managed by Oracle |
| **Storage** | 12GB user data | 20GB per instance |
| **Instances** | Unlimited (resource permitting) | 2 per tenancy |
| **APEX** | Separate download/install | Included and managed |
| **ORDS (REST APIs)** | Separate download/install | Included and managed |
| **Vector Search (AI)** | Yes — native VECTOR type, ONNX on ARM | Yes — full AI Vector Search |
| **JSON Document Store** | Yes | Yes |
| **MongoDB API** | Yes (container version) | Yes |
| **Machine Learning** | Yes (in-database) | Yes + ML Notebooks |
| **SQL Developer** | Separate download | Included (Database Actions) |
| **Security patches** | None — no support | Automatic patching by Oracle |
| **Backups** | Manual only | Limited (no full OCI backups on free tier) |
| **Internet required** | No — fully offline | Yes — cloud hosted |
| **Concurrent users** | Limited by 2GB RAM | ~3-6 simultaneous (30 DB sessions max) |
| **Commercial use** | No restrictions stated | No restrictions stated |
| **Uptime** | Depends on Pi power/stability | Oracle SLA (always-on) |
| **Install complexity** | RPM install + manual APEX/ORDS setup | Click-to-provision, zero setup |
| **Upgrade path** | None — stays free edition | Seamless upgrade to paid tiers |

---

## Option A: Oracle DB Free on Pi 5 (Local ARM)

### What You Get
- Oracle 26ai database running natively on the Pi via aarch64 RPM
- AI Vector Search with ONNX embedding models on ARM
- JSON document store, SQL, REST APIs
- MongoDB-compatible wire protocol
- Runs completely offline

### How It Improves ALEX
1. **Replace flat JSON files** — Conversations (100-msg cap), memory banks, email filing, tasks all move to proper database with indexing and SQL queries
2. **Replace ChromaDB** — Native vector search eliminates the separate Python/ChromaDB process. One database for both structured data and embeddings
3. **MongoDB API** — Node.js can use familiar MongoDB drivers to talk to it, minimal code changes
4. **REST APIs via ORDS** — Dashboard could query the database directly instead of pushing to Redis
5. **Offline resilience** — No internet dependency, everything stays on the Pi

### Concerns
- **2GB RAM limit** — Oracle Free caps SGA+PGA at 2GB. Pi 5 has 8GB total, but Node.js + Oracle + other processes will be tight
- **12GB storage** — Enough for now, but includes indexes and system overhead
- **No security patches** — Oracle explicitly states Free edition receives no patches
- **Manual APEX/ORDS install** — Extra setup work compared to cloud
- **RPM-based** — Designed for Oracle Linux/RHEL. Pi runs Debian Bookworm — may need container anyway
- **Operational overhead** — DBA work (tuning, monitoring, recovery) falls entirely on you

### Best For
Replacing ALEX's flat-file storage with a proper database while keeping everything on-premises.

---

## Option B: Oracle Cloud Always Free (Autonomous Database)

### What You Get
- 2 fully managed Autonomous Database instances
- 1 OCPU + 20GB storage each
- APEX, ORDS, Database Actions, ML Notebooks — all pre-installed
- Automatic patching, tuning, and scaling
- Up to 4 ARM Ampere A1 compute instances (3,000 OCPU hours/month)
- Always-on, Oracle-managed infrastructure

### How It Improves ALEX
1. **Cloud demo environment** — Spin up a clean ALEX instance for corporate demos without touching the Pi
2. **APEX dashboard** — Build a polished admin/demo dashboard with Oracle's low-code tools, zero frontend code
3. **Always-on availability** — Clients can access the demo 24/7 regardless of Pi status
4. **Free ARM compute** — 4 Ampere A1 instances could run a Node.js clone of ALEX in the cloud
5. **Professional presentation** — Oracle Cloud URL + managed infrastructure looks enterprise-grade for client meetings
6. **ML Notebooks** — Built-in Jupyter-like environment for data analysis demos
7. **Seamless upgrade** — If a client wants to scale, upgrade to paid tier with one click

### Architecture for Cloud Demo

```
Corporate client visits demo URL
  → Oracle Cloud ARM instance running ALEX clone
  → Autonomous DB for conversations, memory, vector search
  → APEX dashboard for live monitoring
  → Same Telegram bot or web chat interface
  → Pi stays untouched as production
```

### Concerns
- **3-6 concurrent users** — Free tier is limited for demos with multiple people
- **30 session max** — Hard ceiling on database connections
- **No full backups** — Can't export full DB to OCI object storage on free tier
- **Oracle account required** — Need billing info (credit card) even for free tier
- **Internet dependency** — Cloud goes down, demo goes down
- **Data residency** — ALEX data leaves the Pi and lives on Oracle Cloud
- **Account suspension risk** — Oracle can suspend for inactivity or policy violations

### Best For
A separate, always-on demo environment to showcase ALEX to corporate clients without exposing or risking the production Pi.

---

## Recommendation: Use Both for Different Purposes

### Production (Pi 5) — Keep as-is or migrate to SQLite
The Pi remains ALEX's production brain. Oracle DB Free on ARM is possible but risky given the 2GB RAM cap and Debian compatibility. A lighter option like **SQLite** (for structured data) or **PostgreSQL + pgvector** (if vector search is critical) would give the same benefits with far less overhead.

### Demo/Corporate (Oracle Cloud Always Free) — Strong candidate
This is where Oracle Cloud shines for ALEX:

| Step | Action |
|------|--------|
| 1 | Create Oracle Cloud Always Free account |
| 2 | Provision Autonomous DB (Transaction Processing) |
| 3 | Provision ARM Ampere A1 instance (free compute) |
| 4 | Deploy ALEX clone on the ARM instance |
| 5 | Point it at the Autonomous DB instead of flat files |
| 6 | Build an APEX dashboard for live demo |
| 7 | Give corporate clients a clean URL to interact with ALEX |

**Cost: £0. Runs forever on Always Free tier.**

### The Two-Environment Strategy

```
PRODUCTION (Pi 5)                    DEMO (Oracle Cloud)
├── gateway.js (live)                ├── gateway.js (clone)
├── Flat files / SQLite              ├── Autonomous DB 26ai
├── ChromaDB for RAG                 ├── Native Vector Search
├── Upstash Redis → Vercel           ├── APEX Dashboard
├── Your personal Telegram           ├── Demo Telegram bot / web chat
└── Full 32 tools                    └── Safe subset of tools
```

Production stays private and resilient. Demo is polished, always-on, and disposable — you can tear it down and rebuild without risk.

---

## Decision Matrix

| Criteria | Local ARM (Pi) | Cloud Always Free |
|----------|:-:|:-:|
| Zero cost | Yes | Yes |
| Zero setup effort | No | Nearly |
| Offline capable | Yes | No |
| Corporate demo ready | No | Yes |
| Scales with clients | No | Yes (upgrade path) |
| Data stays private | Yes | No |
| Pi resources consumed | Yes (heavy) | None |
| Security patches | None | Automatic |
| Long-term stability | You manage it | Oracle manages it |

---

## Sources

- https://www.oracle.com/database/free/get-started/
- https://www.oracle.com/autonomous-database/free-trial/
- https://www.oracle.com/database/free/faq/
- https://docs.oracle.com/en/cloud/paas/autonomous-database/serverless/adbsb/autonomous-always-free.html
- https://blogs.oracle.com/database/oracle-announces-oracle-ai-database-26ai
- https://www.oracle.com/database/ai-vector-search/
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
