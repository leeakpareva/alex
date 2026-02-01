/**
 * E2E: Verify all source files pass Node.js syntax check
 */
import { describe, it, expect } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readdir } from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);
const SRC_DIR = path.resolve(import.meta.dirname, '../../src');

describe('Syntax Check (all source files)', () => {
    it('lists all .js files in src/', async () => {
        const files = await readdir(SRC_DIR);
        const jsFiles = files.filter(f => f.endsWith('.js'));
        expect(jsFiles.length).toBeGreaterThan(0);
    });

    it('all src/*.js files pass node --check', async () => {
        const files = await readdir(SRC_DIR);
        const jsFiles = files.filter(f => f.endsWith('.js'));

        const results = [];
        for (const file of jsFiles) {
            const filePath = path.join(SRC_DIR, file);
            try {
                await execAsync(`node --check "${filePath}"`);
                results.push({ file, pass: true });
            } catch (err) {
                results.push({ file, pass: false, error: err.stderr || err.message });
            }
        }

        const failures = results.filter(r => !r.pass);
        if (failures.length > 0) {
            const msg = failures.map(f => `  ${f.file}: ${f.error}`).join('\n');
            expect.fail(`Syntax errors in:\n${msg}`);
        }

        expect(results.every(r => r.pass)).toBe(true);
    });
});
