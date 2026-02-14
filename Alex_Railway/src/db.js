/**
 * Postgres persistence (optional).
 * This is additive: file/Redis behavior remains the primary runtime path.
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
            CREATE TABLE IF NOT EXISTS audit_log (
                id BIGSERIAL PRIMARY KEY,
                ts TIMESTAMPTZ NOT NULL DEFAULT now(),
                entry JSONB NOT NULL
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS exchanges (
                id BIGSERIAL PRIMARY KEY,
                ts TIMESTAMPTZ NOT NULL DEFAULT now(),
                source TEXT,
                user_name TEXT,
                model_label TEXT,
                question TEXT,
                answer TEXT
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS task_outputs (
                id BIGSERIAL PRIMARY KEY,
                ts TIMESTAMPTZ NOT NULL DEFAULT now(),
                task_name TEXT NOT NULL,
                model TEXT,
                content TEXT,
                file_path TEXT,
                meta JSONB
            );
        `);
    }

    async function insertAudit(entry) {
        await pool.query('INSERT INTO audit_log(entry) VALUES($1)', [entry]);
    }

    async function insertExchange(x) {
        await pool.query(
            'INSERT INTO exchanges(source, user_name, model_label, question, answer) VALUES($1,$2,$3,$4,$5)',
            [x.source || null, x.user_name || null, x.model_label || null, x.question || null, x.answer || null]
        );
    }

    async function insertTaskOutput(t) {
        await pool.query(
            'INSERT INTO task_outputs(task_name, model, content, file_path, meta) VALUES($1,$2,$3,$4,$5)',
            [t.task_name, t.model || null, t.content || null, t.file_path || null, t.meta || null]
        );
    }

    async function ping() {
        const r = await pool.query('SELECT 1 as ok');
        return r?.rows?.[0]?.ok === 1;
    }

    return {
        init,
        ping,
        insertAudit,
        insertExchange,
        insertTaskOutput,
    };
}

