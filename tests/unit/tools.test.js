/**
 * Unit tests for tools.js — tool definitions and safe execution
 */
import { describe, it, expect, vi } from 'vitest';
import { TOOLS, executeTool } from '../../src/tools.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Minimal deps for tool execution
const makeDeps = (overrides = {}) => ({
    memory: {
        appendMemory: vi.fn().mockResolvedValue(undefined),
        getMemory: vi.fn().mockResolvedValue('test memory content'),
    },
    skills: { getAllSkills: vi.fn().mockResolvedValue([]) },
    config: {
        gmail_address: 'test@test.com',
        gmail_app_password: 'fake',
        auto_cc_email: 'cc@test.com',
    },
    scheduledTasks: new Map(),
    handleScheduledTask: vi.fn(),
    openaiClient: null,
    bot: null,
    getUploadedFiles: vi.fn().mockReturnValue([]),
    ...overrides,
});

describe('tools.js', () => {
    describe('TOOLS array', () => {
        it('exports a non-empty array', () => {
            expect(Array.isArray(TOOLS)).toBe(true);
            expect(TOOLS.length).toBeGreaterThan(0);
        });

        it('every tool has name, description, and input_schema', () => {
            for (const tool of TOOLS) {
                expect(tool).toHaveProperty('name');
                expect(tool).toHaveProperty('description');
                expect(tool).toHaveProperty('input_schema');
                expect(typeof tool.name).toBe('string');
                expect(typeof tool.description).toBe('string');
                expect(tool.input_schema.type).toBe('object');
            }
        });

        it('has no duplicate tool names', () => {
            const names = TOOLS.map(t => t.name);
            const unique = new Set(names);
            expect(unique.size).toBe(names.length);
        });

        it('includes core tools', () => {
            const names = TOOLS.map(t => t.name);
            expect(names).toContain('bash');
            expect(names).toContain('read_file');
            expect(names).toContain('write_file');
            expect(names).toContain('send_email');
            expect(names).toContain('web_lookup');
            expect(names).toContain('memory_save');
            expect(names).toContain('memory_recall');
            expect(names).toContain('generate_pdf');
            expect(names).toContain('schedule_task');
            expect(names).toContain('update_dashboard');
        });

        it('includes get_recent_uploads tool', () => {
            const names = TOOLS.map(t => t.name);
            expect(names).toContain('get_recent_uploads');
        });

        it('send_email has required fields: to, subject, body', () => {
            const sendEmail = TOOLS.find(t => t.name === 'send_email');
            expect(sendEmail.input_schema.required).toContain('to');
            expect(sendEmail.input_schema.required).toContain('subject');
            expect(sendEmail.input_schema.required).toContain('body');
        });
    });

    describe('executeTool - bash guardrail', () => {
        it('blocks rm commands', async () => {
            const result = await executeTool('bash', { command: 'rm -rf /tmp/test' }, makeDeps());
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/DELETE_GUARDRAIL/);
        });

        it('blocks rmdir commands', async () => {
            const result = await executeTool('bash', { command: 'rmdir /tmp/test' }, makeDeps());
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/DELETE_GUARDRAIL/);
        });

        it('blocks unlink commands', async () => {
            const result = await executeTool('bash', { command: 'unlink /tmp/file' }, makeDeps());
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/DELETE_GUARDRAIL/);
        });

        it('allows safe commands', async () => {
            const result = await executeTool('bash', { command: 'echo hello' }, makeDeps());
            expect(result.success).toBe(true);
            expect(result.stdout.trim()).toBe('hello');
        });

        it('allows ls commands', async () => {
            const result = await executeTool('bash', { command: 'ls /tmp' }, makeDeps());
            expect(result.success).toBe(true);
        });
    });

    describe('executeTool - read_file', () => {
        it('reads a file successfully', async () => {
            const tmpFile = path.join(os.tmpdir(), `alex-test-${Date.now()}.txt`);
            await fs.writeFile(tmpFile, 'test content');
            try {
                const result = await executeTool('read_file', { path: tmpFile }, makeDeps());
                expect(result.success).toBe(true);
                expect(result.content).toBe('test content');
            } finally {
                await fs.unlink(tmpFile).catch(() => {});
            }
        });

        it('fails gracefully for missing files', async () => {
            const result = await executeTool('read_file', { path: '/nonexistent/file.txt' }, makeDeps());
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });
    });

    describe('executeTool - write_file', () => {
        it('writes to allowed paths', async () => {
            const tmpFile = path.join(os.tmpdir(), `alex-write-test-${Date.now()}.txt`);
            try {
                const result = await executeTool('write_file', { path: tmpFile, content: 'hello' }, makeDeps());
                expect(result.success).toBe(true);
                const content = await fs.readFile(tmpFile, 'utf-8');
                expect(content).toBe('hello');
            } finally {
                await fs.unlink(tmpFile).catch(() => {});
            }
        });

        it('rejects writes to disallowed paths', async () => {
            const result = await executeTool('write_file', { path: '/etc/test.txt', content: 'hack' }, makeDeps());
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/denied/i);
        });
    });

    describe('executeTool - memory', () => {
        it('memory_save calls appendMemory', async () => {
            const deps = makeDeps();
            const result = await executeTool('memory_save', { category: 'tasks', content: 'test note' }, deps);
            expect(result.success).toBe(true);
            expect(deps.memory.appendMemory).toHaveBeenCalledWith('tasks', 'test note');
        });

        it('memory_recall calls getMemory', async () => {
            const deps = makeDeps();
            const result = await executeTool('memory_recall', { category: 'research' }, deps);
            expect(result.success).toBe(true);
            expect(result.content).toBe('test memory content');
            expect(deps.memory.getMemory).toHaveBeenCalledWith('research');
        });
    });

    describe('executeTool - list_directory', () => {
        it('lists directory contents', async () => {
            const result = await executeTool('list_directory', { path: os.tmpdir() }, makeDeps());
            expect(result.success).toBe(true);
            expect(Array.isArray(result.items)).toBe(true);
        });

        it('each item has name and type', async () => {
            const result = await executeTool('list_directory', { path: '/home/head/navada-1/src' }, makeDeps());
            expect(result.success).toBe(true);
            for (const item of result.items) {
                expect(item).toHaveProperty('name');
                expect(item).toHaveProperty('type');
                expect(['file', 'directory']).toContain(item.type);
            }
        });
    });

    describe('executeTool - edit_file', () => {
        it('replaces text in a file', async () => {
            const tmpFile = path.join(os.tmpdir(), `alex-edit-test-${Date.now()}.txt`);
            await fs.writeFile(tmpFile, 'hello world');
            try {
                const result = await executeTool('edit_file', {
                    path: tmpFile,
                    old_text: 'world',
                    new_text: 'ALEX',
                }, makeDeps());
                expect(result.success).toBe(true);
                const content = await fs.readFile(tmpFile, 'utf-8');
                expect(content).toBe('hello ALEX');
            } finally {
                await fs.unlink(tmpFile).catch(() => {});
            }
        });

        it('fails if old_text not found', async () => {
            const tmpFile = path.join(os.tmpdir(), `alex-edit-fail-${Date.now()}.txt`);
            await fs.writeFile(tmpFile, 'hello world');
            try {
                const result = await executeTool('edit_file', {
                    path: tmpFile,
                    old_text: 'nonexistent',
                    new_text: 'replacement',
                }, makeDeps());
                expect(result.success).toBe(false);
                expect(result.error).toMatch(/not found/i);
            } finally {
                await fs.unlink(tmpFile).catch(() => {});
            }
        });
    });

    describe('executeTool - web_lookup', () => {
        it('returns a result object', async () => {
            const result = await executeTool('web_lookup', { query: 'test query' }, makeDeps());
            expect(result).toHaveProperty('success');
            // May or may not have results depending on network
        });
    });

    describe('executeTool - get_recent_uploads', () => {
        it('returns empty list when no uploads', async () => {
            const result = await executeTool('get_recent_uploads', {}, makeDeps());
            expect(result.success).toBe(true);
            expect(result.uploads).toEqual([]);
            expect(result.count).toBe(0);
        });

        it('returns uploads when available', async () => {
            const mockUploads = [{ path: '/tmp/photo.jpg', filename: 'photo.jpg', timestamp: Date.now() }];
            const deps = makeDeps({ getUploadedFiles: vi.fn().mockReturnValue(mockUploads) });
            const result = await executeTool('get_recent_uploads', {}, deps);
            expect(result.success).toBe(true);
            expect(result.count).toBe(1);
        });
    });

    describe('executeTool - confirm_delete', () => {
        it('rejects wrong password', async () => {
            const result = await executeTool('confirm_delete', {
                command: 'rm /tmp/test',
                password: 'wrong',
            }, makeDeps());
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/password/i);
        });
    });

    describe('executeTool - unknown tool', () => {
        it('returns error for unknown tool', async () => {
            const result = await executeTool('nonexistent_tool', {}, makeDeps());
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/unknown tool/i);
        });
    });
});
