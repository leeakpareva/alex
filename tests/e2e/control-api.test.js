/**
 * E2E tests for the Control API (port 9090)
 * These test the running ALEX instance — requires `sudo systemctl start alex`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import http from 'http';

const API_BASE = 'http://127.0.0.1:9090';

function apiRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, API_BASE);
        const options = {
            method,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            headers: { 'Content-Type': 'application/json' },
            timeout: 60000,
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });

        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function isAlexRunning() {
    try {
        const res = await apiRequest('GET', '/api/users');
        return res.status === 200;
    } catch {
        return false;
    }
}

describe('Control API (E2E)', () => {
    let alexRunning = false;

    beforeAll(async () => {
        alexRunning = await isAlexRunning();
        if (!alexRunning) {
            console.log('[E2E] ALEX is not running — skipping e2e tests. Start with: sudo systemctl start alex');
        }
    });

    describe('GET /api/users', () => {
        it('returns user list', async () => {
            if (!alexRunning) return;
            const res = await apiRequest('GET', '/api/users');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('success', true);
            expect(res.body).toHaveProperty('users');
            expect(Array.isArray(res.body.users)).toBe(true);
        });
    });

    describe('POST /api/command', () => {
        it('rejects empty message', async () => {
            if (!alexRunning) return;
            const res = await apiRequest('POST', '/api/command', {});
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
        });

        it('processes a simple command', async () => {
            if (!alexRunning) return;
            const res = await apiRequest('POST', '/api/command', {
                message: 'What is 2+2? Reply with just the number.',
                send_to_telegram: false,
            });
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('success', true);
            expect(res.body).toHaveProperty('response');
            expect(typeof res.body.response).toBe('string');
        }, 60000);
    });

    describe('POST /api/trigger', () => {
        it('rejects missing task name', async () => {
            if (!alexRunning) return;
            const res = await apiRequest('POST', '/api/trigger', {});
            expect(res.status).toBe(400);
        });

        it('rejects unknown task', async () => {
            if (!alexRunning) return;
            const res = await apiRequest('POST', '/api/trigger', { task: 'nonexistent-task-xyz' });
            expect(res.status).toBe(404);
        });

        it('accepts dashboard-sync task', async () => {
            if (!alexRunning) return;
            const res = await apiRequest('POST', '/api/trigger', { task: 'dashboard-sync' });
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('success', true);
        });
    });

    describe('POST /api/send', () => {
        it('rejects missing parameters', async () => {
            if (!alexRunning) return;
            const res = await apiRequest('POST', '/api/send', {});
            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/broadcast', () => {
        it('rejects empty broadcast', async () => {
            if (!alexRunning) return;
            const res = await apiRequest('POST', '/api/broadcast', {});
            expect(res.status).toBe(400);
        });
    });

    describe('unknown endpoint', () => {
        it('returns 404', async () => {
            if (!alexRunning) return;
            const res = await apiRequest('GET', '/api/nonexistent');
            expect(res.status).toBe(404);
        });
    });
});
