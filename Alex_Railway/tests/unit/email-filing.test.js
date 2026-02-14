/**
 * Unit tests for email-filing.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import os from 'os';

// Use a temp directory for tests
const TEST_DIR = path.join(os.tmpdir(), 'alex-test-inbox-' + Date.now());
const TEST_EMAILS_FILE = path.join(TEST_DIR, 'inbox', 'emails.json');

// Mock WORKSPACE_PATH before importing
vi.mock('../../src/config.js', () => ({
    WORKSPACE_PATH: TEST_DIR,
}));

const emailFiling = await import('../../src/email-filing.js');

describe('email-filing.js', () => {
    beforeEach(async () => {
        await mkdir(path.join(TEST_DIR, 'inbox'), { recursive: true });
        // Reset store
        await writeFile(TEST_EMAILS_FILE, JSON.stringify({ emails: [], stats: { not_started: 0, in_progress: 0, done: 0 } }));
        // Setup with no external deps (no anthropic = fallback triage)
        emailFiling.setupEmailFiling({
            config: {},
            bot: null,
            anthropic: null,
            postDashboard: null,
            memory: null,
        });
    });

    afterEach(async () => {
        await rm(TEST_DIR, { recursive: true, force: true });
    });

    describe('triageEmail', () => {
        it('returns fallback triage when no anthropic client', async () => {
            const result = await emailFiling.triageEmail('John', 'john@test.com', 'Hello', 'Test body');
            expect(result).toHaveProperty('priority', 'medium');
            expect(result).toHaveProperty('category', 'general');
            expect(result).toHaveProperty('can_handle_autonomously', false);
            expect(result).toHaveProperty('summary');
            expect(result).toHaveProperty('suggested_response');
        });
    });

    describe('fileEmail', () => {
        it('files an email and returns a record with triage', async () => {
            const record = await emailFiling.fileEmail({
                uid: 100,
                fromName: 'Jane Doe',
                fromAddress: 'jane@example.com',
                subject: 'Partnership inquiry',
                bodyText: 'Hi, I would like to discuss a partnership.',
                date: new Date(),
                messageId: '<msg1@example.com>',
            });

            expect(record).toHaveProperty('id');
            expect(record.id).toMatch(/^e_/);
            expect(record.display_number).toBe(1);
            expect(record.status).toBe('not_started');
            expect(record.from_name).toBe('Jane Doe');
            expect(record.from_address).toBe('jane@example.com');
            expect(record.subject).toBe('Partnership inquiry');
            expect(record.triage).toBeDefined();
            expect(record.triage.priority).toBe('medium');
        });

        it('assigns incrementing display numbers', async () => {
            const r1 = await emailFiling.fileEmail({
                uid: 1, fromName: 'A', fromAddress: 'a@test.com',
                subject: 'First', bodyText: 'body', date: new Date(),
            });
            const r2 = await emailFiling.fileEmail({
                uid: 2, fromName: 'B', fromAddress: 'b@test.com',
                subject: 'Second', bodyText: 'body', date: new Date(),
            });

            expect(r2.display_number).toBe(r1.display_number + 1);
        });

        it('detects threads via inReplyTo', async () => {
            const r1 = await emailFiling.fileEmail({
                uid: 1, fromName: 'A', fromAddress: 'a@test.com',
                subject: 'Original', bodyText: 'body', date: new Date(),
                messageId: '<original@test.com>',
            });

            const r2 = await emailFiling.fileEmail({
                uid: 2, fromName: 'B', fromAddress: 'b@test.com',
                subject: 'Re: Original', bodyText: 'reply', date: new Date(),
                messageId: '<reply@test.com>',
                inReplyTo: '<original@test.com>',
            });

            expect(r2.thread_id).toBe(r1.id);
        });

        it('records auto_replied action', async () => {
            const record = await emailFiling.fileEmail({
                uid: 1, fromName: 'A', fromAddress: 'a@test.com',
                subject: 'Test', bodyText: 'body', date: new Date(),
                autoReplied: true,
            });

            expect(record.auto_replied).toBe(true);
            expect(record.actions).toHaveLength(1);
            expect(record.actions[0].type).toBe('auto_reply');
        });

        it('persists to disk', async () => {
            await emailFiling.fileEmail({
                uid: 1, fromName: 'Disk Test', fromAddress: 'disk@test.com',
                subject: 'Persist', bodyText: 'body', date: new Date(),
            });

            const raw = await readFile(TEST_EMAILS_FILE, 'utf-8');
            const store = JSON.parse(raw);
            expect(store.emails).toHaveLength(1);
            expect(store.stats.not_started).toBe(1);
        });

        it('truncates body_text to 10000 chars', async () => {
            const longBody = 'x'.repeat(20000);
            const record = await emailFiling.fileEmail({
                uid: 1, fromName: 'A', fromAddress: 'a@test.com',
                subject: 'Long', bodyText: longBody, date: new Date(),
            });
            expect(record.body_text.length).toBe(10000);
        });
    });

    describe('updateEmailStatus', () => {
        it('transitions status and logs action', async () => {
            const filed = await emailFiling.fileEmail({
                uid: 1, fromName: 'A', fromAddress: 'a@test.com',
                subject: 'Test', bodyText: 'body', date: new Date(),
            });

            const updated = await emailFiling.updateEmailStatus(filed.id, 'in_progress', 'Working on it');
            expect(updated.status).toBe('in_progress');
            expect(updated.actions).toHaveLength(1);
            expect(updated.actions[0].description).toBe('Working on it');
        });

        it('returns null for non-existent email', async () => {
            const result = await emailFiling.updateEmailStatus('nonexistent', 'done', 'test');
            expect(result).toBeNull();
        });
    });

    describe('getEmailsByStatus', () => {
        it('filters by status', async () => {
            await emailFiling.fileEmail({
                uid: 1, fromName: 'A', fromAddress: 'a@test.com',
                subject: 'First', bodyText: 'body', date: new Date(),
            });
            const filed2 = await emailFiling.fileEmail({
                uid: 2, fromName: 'B', fromAddress: 'b@test.com',
                subject: 'Second', bodyText: 'body', date: new Date(),
            });
            await emailFiling.updateEmailStatus(filed2.id, 'in_progress', 'started');

            const notStarted = await emailFiling.getEmailsByStatus('not_started');
            expect(notStarted).toHaveLength(1);
            expect(notStarted[0].subject).toBe('First');

            const inProgress = await emailFiling.getEmailsByStatus('in_progress');
            expect(inProgress).toHaveLength(1);
            expect(inProgress[0].subject).toBe('Second');
        });

        it('returns all emails with status=all', async () => {
            await emailFiling.fileEmail({
                uid: 1, fromName: 'A', fromAddress: 'a@test.com',
                subject: 'One', bodyText: 'body', date: new Date(),
            });
            await emailFiling.fileEmail({
                uid: 2, fromName: 'B', fromAddress: 'b@test.com',
                subject: 'Two', bodyText: 'body', date: new Date(),
            });

            const all = await emailFiling.getEmailsByStatus('all');
            expect(all).toHaveLength(2);
        });
    });

    describe('getEmailByNumber', () => {
        it('finds email by display number', async () => {
            const filed = await emailFiling.fileEmail({
                uid: 1, fromName: 'FindMe', fromAddress: 'find@test.com',
                subject: 'Find This', bodyText: 'body', date: new Date(),
            });

            const found = await emailFiling.getEmailByNumber(filed.display_number);
            expect(found).not.toBeNull();
            expect(found.from_name).toBe('FindMe');
        });

        it('returns null for non-existent number', async () => {
            const found = await emailFiling.getEmailByNumber(99999);
            expect(found).toBeNull();
        });
    });

    describe('getInboxSummary', () => {
        it('returns structured summary with stats', async () => {
            await emailFiling.fileEmail({
                uid: 1, fromName: 'A', fromAddress: 'a@test.com',
                subject: 'Test', bodyText: 'body', date: new Date(),
            });

            const summary = await emailFiling.getInboxSummary();
            expect(summary).toHaveProperty('not_started');
            expect(summary).toHaveProperty('in_progress');
            expect(summary).toHaveProperty('done_recent');
            expect(summary).toHaveProperty('stats');
            expect(summary.not_started).toHaveLength(1);
            expect(summary.stats.not_started).toBe(1);
        });
    });

    describe('archiveOldDone', () => {
        it('prunes done emails older than 30 days', async () => {
            // File and mark as done
            const filed = await emailFiling.fileEmail({
                uid: 1, fromName: 'Old', fromAddress: 'old@test.com',
                subject: 'Old email', bodyText: 'body', date: new Date(),
            });
            await emailFiling.updateEmailStatus(filed.id, 'done', 'completed');

            // Manually backdate the updated_at
            const raw = await readFile(TEST_EMAILS_FILE, 'utf-8');
            const store = JSON.parse(raw);
            store.emails[0].updated_at = new Date(Date.now() - 31 * 86400000).toISOString();
            await writeFile(TEST_EMAILS_FILE, JSON.stringify(store));

            const pruned = await emailFiling.archiveOldDone();
            expect(pruned).toBe(1);

            const remaining = await emailFiling.getEmailsByStatus('all');
            expect(remaining).toHaveLength(0);
        });

        it('keeps recent done emails', async () => {
            const filed = await emailFiling.fileEmail({
                uid: 1, fromName: 'Recent', fromAddress: 'r@test.com',
                subject: 'Recent', bodyText: 'body', date: new Date(),
            });
            await emailFiling.updateEmailStatus(filed.id, 'done', 'completed');

            const pruned = await emailFiling.archiveOldDone();
            expect(pruned).toBe(0);
        });

        it('never prunes non-done emails', async () => {
            await emailFiling.fileEmail({
                uid: 1, fromName: 'Active', fromAddress: 'a@test.com',
                subject: 'Active', bodyText: 'body', date: new Date(),
            });

            const pruned = await emailFiling.archiveOldDone();
            expect(pruned).toBe(0);
        });
    });
});
