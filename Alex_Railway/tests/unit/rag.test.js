/**
 * Unit tests for content-cache.js (RAG/cache system)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cacheFacts, getCachedFacts, searchCache, cleanExpired, getCacheStats } from '../../src/content-cache.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const CACHE_DIR = path.join(os.homedir(), '.alex', 'cache', 'content');

describe('content-cache.js', () => {
    // Test facts to use across tests
    const testSource = `test-source-${Date.now()}`;
    const testFacts = [
        { topic: 'AAPL stock', value: '$185.50', detail: 'Up 2.3% today' },
        { topic: 'Bitcoin', value: '$43,200', detail: 'Stable, slight uptrend' },
    ];

    describe('cacheFacts', () => {
        it('saves facts without error', async () => {
            await expect(cacheFacts(testSource, testFacts, 1)).resolves.not.toThrow();
        });

        it('skips empty facts array', async () => {
            await expect(cacheFacts('empty-test', [])).resolves.not.toThrow();
        });

        it('skips null facts', async () => {
            await expect(cacheFacts('null-test', null)).resolves.not.toThrow();
        });
    });

    describe('getCachedFacts', () => {
        const uniqueSource = `get-test-${Date.now()}`;

        it('returns null for non-existent source', async () => {
            const result = await getCachedFacts('nonexistent-source-xyz');
            expect(result).toBeNull();
        });

        it('returns cached facts after saving', async () => {
            await cacheFacts(uniqueSource, testFacts, 24);
            const result = await getCachedFacts(uniqueSource);
            expect(result).not.toBeNull();
            expect(result.source).toBe(uniqueSource);
            expect(result.facts).toHaveLength(2);
            expect(result.facts[0].topic).toBe('AAPL stock');
            expect(result).toHaveProperty('age_hours');
            expect(result).toHaveProperty('created');
        });
    });

    describe('searchCache', () => {
        const searchSource = `search-test-${Date.now()}`;

        it('finds facts by keyword', async () => {
            await cacheFacts(searchSource, [
                { topic: 'Gold price', value: '$2,050/oz', detail: 'Near all-time high' },
                { topic: 'Oil price', value: '$78/barrel', detail: 'WTI crude stable' },
            ], 24);

            const results = await searchCache('gold');
            expect(results.length).toBeGreaterThanOrEqual(1);
            const goldResult = results.find(r => r.fact.topic === 'Gold price');
            expect(goldResult).toBeDefined();
            expect(goldResult.fact.value).toBe('$2,050/oz');
        });

        it('returns empty array for no matches', async () => {
            const results = await searchCache('zzz-nonexistent-keyword-zzz');
            expect(results).toEqual([]);
        });

        it('search is case-insensitive', async () => {
            const results = await searchCache('GOLD');
            const goldResult = results.find(r => r.fact.topic === 'Gold price');
            expect(goldResult).toBeDefined();
        });
    });

    describe('cleanExpired', () => {
        it('returns a number (cleaned count)', async () => {
            const result = await cleanExpired();
            expect(typeof result).toBe('number');
            expect(result).toBeGreaterThanOrEqual(0);
        });
    });

    describe('getCacheStats', () => {
        it('returns stats object with expected fields', async () => {
            const stats = await getCacheStats();
            expect(stats).toHaveProperty('entries');
            expect(stats).toHaveProperty('oldest_hours');
            expect(stats).toHaveProperty('newest_hours');
            expect(stats).toHaveProperty('total_facts');
            expect(stats).toHaveProperty('max_entries');
            expect(stats).toHaveProperty('ttl_hours');
            expect(typeof stats.entries).toBe('number');
            expect(typeof stats.total_facts).toBe('number');
            expect(stats.max_entries).toBe(50);
            expect(stats.ttl_hours).toBe(72);
        });

        it('entries count is non-negative', async () => {
            const stats = await getCacheStats();
            expect(stats.entries).toBeGreaterThanOrEqual(0);
        });
    });
});
