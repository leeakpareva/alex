/**
 * Postgres persistence (optional).
 *
 * Goal: durable logging for watchdog + Ralph + reports without affecting runtime if DB is absent.
 */

import pg from 'pg';

const { Pool } = pg;

export function createDb(databaseUrl) {
    if (!databaseUrl) return null;

    const pool = new Pool({
        connectionString: databaseUrl,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    });

    async function init() {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS connectivity_events (
                id BIGSERIAL PRIMARY KEY,
                ts TIMESTAMPTZ NOT NULL DEFAULT now(),
                name TEXT NOT NULL,
                ok BOOLEAN NOT NULL,
                detail TEXT,
                meta JSONB
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ralph_reviews (
                id BIGSERIAL PRIMARY KEY,
                ts TIMESTAMPTZ NOT NULL DEFAULT now(),
                model TEXT,
                issues JSONB,
                fixes JSONB,
                health TEXT,
                review TEXT NOT NULL
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS agent_reports (
                id BIGSERIAL PRIMARY KEY,
                ts TIMESTAMPTZ NOT NULL DEFAULT now(),
                kind TEXT NOT NULL,
                content TEXT NOT NULL,
                meta JSONB
            );
        `);
    }

    async function insertConnectivityEvent(e) {
        await pool.query(
            'INSERT INTO connectivity_events(name, ok, detail, meta) VALUES ($1,$2,$3,$4)',
            [e.name, !!e.ok, e.detail || null, e.meta || null]
        );
    }

    async function insertRalphReview(r) {
        await pool.query(
            'INSERT INTO ralph_reviews(model, issues, fixes, health, review) VALUES ($1,$2,$3,$4,$5)',
            [r.model || null, r.issues || null, r.fixes || null, r.health || null, r.review]
        );
    }

    async function insertReport(r) {
        await pool.query(
            'INSERT INTO agent_reports(kind, content, meta) VALUES ($1,$2,$3)',
            [r.kind, r.content, r.meta || null]
        );
    }

    async function close() {
        await pool.end().catch(() => {});
    }

    return { init, insertConnectivityEvent, insertRalphReview, insertReport, close };
}

