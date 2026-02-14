/**
 * Unit tests for heartbeat.js
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_TASKS, isRepeatOutput } from '../../src/heartbeat.js';

describe('heartbeat.js', () => {
    describe('BUILTIN_TASKS', () => {
        it('is a Map', () => {
            expect(BUILTIN_TASKS).toBeInstanceOf(Map);
        });

        it('has expected built-in tasks', () => {
            expect(BUILTIN_TASKS.has('morning-briefing')).toBe(true);
            expect(BUILTIN_TASKS.has('midmorning-checkin')).toBe(true);
            expect(BUILTIN_TASKS.has('midday-research')).toBe(true);
            expect(BUILTIN_TASKS.has('afternoon-checkin')).toBe(true);
            expect(BUILTIN_TASKS.has('evening-summary')).toBe(true);
            expect(BUILTIN_TASKS.has('weekly-self-review')).toBe(true);
        });

        it('has inbox-review task', () => {
            expect(BUILTIN_TASKS.has('inbox-review')).toBe(true);
            const task = BUILTIN_TASKS.get('inbox-review');
            expect(task.name).toBe('inbox-review');
            expect(task.task_description).toMatch(/inbox/i);
            expect(task.task_description).toMatch(/not_started/i);
        });

        it('every task has name and task_description', () => {
            for (const [key, task] of BUILTIN_TASKS) {
                expect(task).toHaveProperty('name');
                expect(task).toHaveProperty('task_description');
                expect(typeof task.name).toBe('string');
                expect(typeof task.task_description).toBe('string');
                expect(task.name).toBe(key);
                expect(task.task_description.length).toBeGreaterThan(10);
            }
        });

        it('has at least 7 tasks', () => {
            expect(BUILTIN_TASKS.size).toBeGreaterThanOrEqual(7);
        });
    });

    describe('isRepeatOutput (anti-repetition)', () => {
        it('returns false for first occurrence', () => {
            const result = isRepeatOutput('test-unique-first', 'This is brand new content that has never been seen before');
            expect(result).toBe(false);
        });

        it('returns true for duplicate within window', () => {
            const text = 'Duplicate detection test content for repeat check';
            isRepeatOutput('test-dedup', text); // First call — registers it
            const result = isRepeatOutput('test-dedup', text); // Second call — should detect
            expect(result).toBe(true);
        });

        it('returns false for different content', () => {
            const text1 = 'First unique message about markets rising today';
            const text2 = 'Completely different message about weather forecast';
            isRepeatOutput('test-diff', text1);
            const result = isRepeatOutput('test-diff', text2);
            expect(result).toBe(false);
        });

        it('returns false for same content on different tasks', () => {
            const text = 'Shared content across different task names for isolation test';
            isRepeatOutput('task-alpha', text);
            const result = isRepeatOutput('task-beta', text);
            expect(result).toBe(false);
        });
    });
});
