/**
 * Unit tests for config.js
 */
import { describe, it, expect } from 'vitest';
import { isPathAllowed, WORKSPACE_PATH, ALLOWED_WRITE_PATHS, ALLOWED_ATTACHMENT_PATHS } from '../../src/config.js';

describe('config.js', () => {
    describe('isPathAllowed', () => {
        it('allows paths within WORKSPACE_PATH', () => {
            expect(isPathAllowed(`${WORKSPACE_PATH}/reports/test.pdf`, ALLOWED_WRITE_PATHS)).toBe(true);
        });

        it('allows paths within /home/head', () => {
            expect(isPathAllowed('/home/head/somefile.txt', ALLOWED_WRITE_PATHS)).toBe(true);
        });

        it('allows /tmp paths', () => {
            expect(isPathAllowed('/tmp/test.txt', ALLOWED_WRITE_PATHS)).toBe(true);
        });

        it('rejects paths outside allowed directories', () => {
            expect(isPathAllowed('/etc/passwd', ALLOWED_WRITE_PATHS)).toBe(false);
        });

        it('rejects root paths', () => {
            expect(isPathAllowed('/root/.ssh/id_rsa', ALLOWED_WRITE_PATHS)).toBe(false);
        });

        it('rejects path traversal attempts', () => {
            expect(isPathAllowed('/home/head/../../etc/passwd', ALLOWED_WRITE_PATHS)).toBe(false);
        });

        it('handles attachment paths correctly', () => {
            expect(isPathAllowed(`${WORKSPACE_PATH}/reports/report.pdf`, ALLOWED_ATTACHMENT_PATHS)).toBe(true);
            expect(isPathAllowed('/var/log/syslog', ALLOWED_ATTACHMENT_PATHS)).toBe(false);
        });
    });

    describe('constants', () => {
        it('WORKSPACE_PATH ends with .alex', () => {
            expect(WORKSPACE_PATH).toMatch(/\.alex$/);
        });

        it('ALLOWED_WRITE_PATHS contains workspace', () => {
            expect(ALLOWED_WRITE_PATHS).toContain(WORKSPACE_PATH);
        });

        it('ALLOWED_WRITE_PATHS contains /tmp', () => {
            expect(ALLOWED_WRITE_PATHS).toContain('/tmp');
        });
    });
});
