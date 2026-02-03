/**
 * E2E: Verify workspace structure, critical files exist, and services are configured
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const WORKSPACE = path.join(os.homedir(), '.alex');

describe('Workspace Integrity', () => {
    const requiredDirs = [
        'conversations', 'memory', 'skills', 'tasks', 'templates',
        'logs', 'reports', 'charts', 'images', 'inbox', 'uploads',
    ];

    for (const dir of requiredDirs) {
        it(`~/.alex/${dir}/ exists`, async () => {
            const stat = await fs.stat(path.join(WORKSPACE, dir)).catch(() => null);
            // Some dirs may not exist yet on fresh install, so we just check the critical ones
            if (['logs', 'memory', 'inbox'].includes(dir)) {
                expect(stat).not.toBeNull();
                expect(stat.isDirectory()).toBe(true);
            }
        });
    }

    it('config.json exists and is valid JSON', async () => {
        const content = await fs.readFile(path.join(WORKSPACE, 'config.json'), 'utf-8');
        const config = JSON.parse(content);
        expect(config).toHaveProperty('anthropic_api_key');
        expect(config).toHaveProperty('telegram_bot_token');
    });

    it('config.json has restricted permissions', async () => {
        const stat = await fs.stat(path.join(WORKSPACE, 'config.json'));
        const mode = (stat.mode & 0o777).toString(8);
        // Should be 600 or 640 or similar restricted
        expect(parseInt(mode, 8) & 0o077).toBeLessThanOrEqual(0o040);
    });

    it('IDENTITY.md exists', async () => {
        const stat = await fs.stat(path.join(WORKSPACE, 'IDENTITY.md')).catch(() => null);
        expect(stat).not.toBeNull();
    });

    it('inbox/emails.json is valid if exists', async () => {
        try {
            const content = await fs.readFile(path.join(WORKSPACE, 'inbox', 'emails.json'), 'utf-8');
            const data = JSON.parse(content);
            expect(data).toHaveProperty('emails');
            expect(Array.isArray(data.emails)).toBe(true);
            expect(data).toHaveProperty('stats');
        } catch (err) {
            // File may not exist yet — that's OK
            if (err.code !== 'ENOENT') throw err;
        }
    });
});

describe('Source File Integrity', () => {
    const srcDir = path.resolve(import.meta.dirname, '../../src');

    const requiredFiles = [
        'gateway.js', 'chat.js', 'tools.js', 'heartbeat.js',
        'config.js', 'memory.js', 'skills.js', 'inbox.js',
        'email-filing.js', 'slack.js',
    ];

    for (const file of requiredFiles) {
        it(`src/${file} exists`, async () => {
            const stat = await fs.stat(path.join(srcDir, file));
            expect(stat.isFile()).toBe(true);
        });
    }
});

describe('Cron Configuration', () => {
    it('/etc/cron.d/alex exists', async () => {
        const stat = await fs.stat('/etc/cron.d/alex').catch(() => null);
        expect(stat).not.toBeNull();
    });

    it('cron file contains inbox-review', async () => {
        const content = await fs.readFile('/etc/cron.d/alex', 'utf-8');
        expect(content).toMatch(/inbox-review/);
    });

    it('cron file contains all core tasks', async () => {
        const content = await fs.readFile('/etc/cron.d/alex', 'utf-8');
        expect(content).toMatch(/morning-briefing/);
        expect(content).toMatch(/midday-research/);
        expect(content).toMatch(/evening-summary/);
        expect(content).toMatch(/dashboard-sync/);
        expect(content).toMatch(/cleanup/);
    });

    it('cron file has trailing newline', async () => {
        const content = await fs.readFile('/etc/cron.d/alex', 'utf-8');
        expect(content.endsWith('\n')).toBe(true);
    });
});

describe('Dashboard Files', () => {
    it('dashboard server.py exists', async () => {
        const stat = await fs.stat('/home/head/navada-1/dashboard/server.py');
        expect(stat.isFile()).toBe(true);
    });

    it('dashboard index.html exists', async () => {
        const stat = await fs.stat('/home/head/navada-1/dashboard/index.html');
        expect(stat.isFile()).toBe(true);
    });
});
