/**
 * Connectivity watchdog for Railway.
 *
 * Purpose:
 * - Periodically probe internal dependencies (Chroma, Redis, Postgres, nodejs, http-nodejs, AnythingLLM).
 * - Log state transitions so "disconnected" events have evidence in logs.
 * - Optionally self-keepalive (useful if the platform sleeps idle services).
 *
 * Safety:
 * - Never throws; failures are logged and the app continues.
 * - Never logs secrets (only statuses and hostnames).
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import http from 'http';
import https from 'https';
import net from 'net';

function nowIso() {
    return new Date().toISOString();
}

async function ensureLogFile(filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, '');
}

async function appendLine(filePath, line) {
    await fs.appendFile(filePath, line + '\n');
}

function httpGet(url, { timeoutMs = 5000 } = {}) {
    return new Promise(resolve => {
        try {
            const u = new URL(url);
            const lib = u.protocol === 'https:' ? https : http;
            const req = lib.request(
                {
                    method: 'GET',
                    hostname: u.hostname,
                    port: u.port || (u.protocol === 'https:' ? 443 : 80),
                    path: u.pathname + u.search,
                    timeout: timeoutMs,
                },
                res => {
                    res.on('data', () => {});
                    res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, code: res.statusCode }));
                    res.resume();
                }
            );
            req.on('timeout', () => req.destroy(new Error('timeout')));
            req.on('error', e => resolve({ ok: false, error: e.message }));
            req.end();
        } catch (e) {
            resolve({ ok: false, error: e.message });
        }
    });
}

function tcpPing(host, port, { timeoutMs = 3000 } = {}) {
    return new Promise(resolve => {
        const socket = new net.Socket();
        let done = false;

        function finish(result) {
            if (done) return;
            done = true;
            try { socket.destroy(); } catch {}
            resolve(result);
        }

        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish({ ok: true }));
        socket.once('timeout', () => finish({ ok: false, error: 'timeout' }));
        socket.once('error', e => finish({ ok: false, error: e.message }));
        socket.connect(port, host);
    });
}

function safeUrlLabel(url) {
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname || '/'}`;
    } catch {
        return String(url);
    }
}

function parseHostPortFromUrl(url, fallbackHost, fallbackPort) {
    try {
        const u = new URL(url);
        return { host: u.hostname || fallbackHost, port: Number(u.port) || fallbackPort };
    } catch {
        return { host: fallbackHost, port: fallbackPort };
    }
}

export function startConnectivityWatchdog({
    intervalMs = Number(process.env.CONNECTIVITY_WATCHDOG_INTERVAL_MS || 60_000),
    keepalive = process.env.CONNECTIVITY_KEEPALIVE !== '0',
    // If true, also ping the public domain (helps prevent "Sleep when idle" scale-to-zero).
    publicKeepalive = process.env.CONNECTIVITY_PUBLIC_KEEPALIVE !== '0',
    logFile = process.env.CONNECTIVITY_LOG_FILE || path.join(os.homedir(), '.alex', 'logs', 'connectivity-watchdog.log'),
} = {}) {
    if (process.env.CONNECTIVITY_WATCHDOG === '0') {
        console.log('[WATCHDOG] Disabled via CONNECTIVITY_WATCHDOG=0');
        return { stop: () => {} };
    }

    const last = new Map();
    let timer = null;

    const chromaBase = process.env.CHROMA_BASE_URL || 'http://chroma.railway.internal:8000';
    const nodejsBase = process.env.NODEJS_BASE_URL || 'http://nodejs.railway.internal:3000';
    const httpNodejsBase = process.env.HTTP_NODEJS_BASE_URL || 'http://http-nodejs.railway.internal:8080';
    const anythingInternal = process.env.ANYTHINGLLM_INTERNAL_URL || 'http://anythingllm.railway.internal:3001';
    const anythingPublic = process.env.ANYTHINGLLM_URL || null;

    const redisUrl = process.env.REDIS_URL || process.env.LOCAL_REDIS_URL || null;
    const pgUrl = process.env.DATABASE_URL || process.env.database_url || null;

    const redisTarget = redisUrl ? parseHostPortFromUrl(redisUrl, 'redis.railway.internal', 6379) : { host: 'redis.railway.internal', port: 6379 };
    const pgTarget = pgUrl ? parseHostPortFromUrl(pgUrl, 'postgres.railway.internal', 5432) : { host: 'postgres.railway.internal', port: 5432 };

    const targets = [
        // Strip trailing slashes from base URL.
        { name: 'chroma', kind: 'http', url: `${chromaBase.replace(/\/+$/, '')}/api/v2/heartbeat` },
        { name: 'nodejs', kind: 'http', url: nodejsBase },
        { name: 'http-nodejs', kind: 'http', url: httpNodejsBase },
        { name: 'anythingllm-internal', kind: 'http', url: anythingInternal },
        ...(anythingPublic ? [{ name: 'anythingllm-public', kind: 'http', url: anythingPublic }] : []),
        { name: 'redis', kind: 'tcp', host: redisTarget.host, port: redisTarget.port },
        { name: 'postgres', kind: 'tcp', host: pgTarget.host, port: pgTarget.port },
    ];

    async function logTransition(name, status) {
        const line = `[${nowIso()}] ${name} ${status.ok ? 'OK' : 'FAIL'} ${status.detail || ''}`.trimEnd();
        try {
            await appendLine(logFile, line);
        } catch (e) {
            console.warn('[WATCHDOG] log write failed:', e.message);
        }
    }

    async function probeOnce() {
        for (const t of targets) {
            if (t.kind === 'http') {
                const r = await httpGet(t.url, { timeoutMs: 5000 });
                const detail = r.ok ? `code=${r.code} url=${safeUrlLabel(t.url)}` : `err=${r.error || 'http_fail'} url=${safeUrlLabel(t.url)}`;
                const prev = last.get(t.name);
                const cur = { ok: !!r.ok, detail };
                if (!prev || prev.ok !== cur.ok) {
                    last.set(t.name, cur);
                    await logTransition(t.name, cur);
                }
            } else if (t.kind === 'tcp') {
                const r = await tcpPing(t.host, t.port, { timeoutMs: 3000 });
                const detail = r.ok ? `host=${t.host}:${t.port}` : `err=${r.error || 'tcp_fail'} host=${t.host}:${t.port}`;
                const prev = last.get(t.name);
                const cur = { ok: !!r.ok, detail };
                if (!prev || prev.ok !== cur.ok) {
                    last.set(t.name, cur);
                    await logTransition(t.name, cur);
                }
            }
        }

        if (keepalive) {
            const port = process.env.ALEX_PORT || '9090';
            await httpGet(`http://127.0.0.1:${port}/api/health`, { timeoutMs: 2000 }).catch(() => {});
        }

        if (keepalive && publicKeepalive) {
            // Generate inbound router traffic so Railway doesn't consider the service idle.
            const pub = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL || null;
            if (pub) {
                await httpGet(`https://${pub}/api/health`, { timeoutMs: 4000 }).catch(() => {});
            }
        }
    }

    (async () => {
        try {
            await ensureLogFile(logFile);
            await appendLine(
                logFile,
                `[${nowIso()}] watchdog start intervalMs=${intervalMs} keepalive=${keepalive ? 'on' : 'off'}`
            );
        } catch (e) {
            console.warn('[WATCHDOG] init failed:', e.message);
        }
    })();

    probeOnce().catch(() => {});
    timer = setInterval(() => probeOnce().catch(() => {}), intervalMs);

    console.log(`[WATCHDOG] Started (${Math.round(intervalMs / 1000)}s) log=${logFile}`);

    return {
        stop: () => {
            if (timer) clearInterval(timer);
            timer = null;
        },
    };
}

