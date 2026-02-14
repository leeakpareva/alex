/**
 * Content Cache — Stores facts extracted from ALEX's own outputs (heartbeat tasks,
 * research, emails) so they can be reused without burning expensive LLM tokens.
 *
 * Cache facts, not prose. Haiku rewrites fresh each time to stay natural.
 * 3-day TTL. 50-entry cap. JSON files in ~/.alex/cache/content/.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { WORKSPACE_PATH } from './config.js';

const CACHE_DIR = path.join(WORKSPACE_PATH, 'cache', 'content');
const MAX_ENTRIES = 50;
const DEFAULT_TTL_HOURS = 72; // 3 days

/**
 * Ensure the cache directory exists.
 */
async function ensureCacheDir() {
    await fs.mkdir(CACHE_DIR, { recursive: true });
}

/**
 * Generate a short hash for a topic/source combination.
 */
function cacheKey(source, topic) {
    const raw = `${source}:${topic}`.toLowerCase().trim();
    return crypto.createHash('md5').update(raw).digest('hex').slice(0, 12);
}

/**
 * Save facts to the content cache.
 * @param {string} source - e.g. 'morning-briefing', 'midday-research', 'stock-alerts'
 * @param {Array} facts - Array of fact objects: [{ topic, value, detail?, change? }]
 * @param {number} [ttlHours] - How long to keep (default 72h)
 */
export async function cacheFacts(source, facts, ttlHours = DEFAULT_TTL_HOURS) {
    if (!facts || facts.length === 0) return;
    await ensureCacheDir();

    const entry = {
        source,
        facts,
        created: new Date().toISOString(),
        expires: new Date(Date.now() + ttlHours * 3600 * 1000).toISOString(),
        ttl_hours: ttlHours,
    };

    const key = cacheKey(source, facts.map(f => f.topic).join(','));
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    await fs.writeFile(filePath, JSON.stringify(entry, null, 2));

    // Enforce cap
    await enforceCap();
}

/**
 * Look up cached facts by source name.
 * Returns fresh facts or null if expired/missing.
 * @param {string} source - e.g. 'morning-briefing'
 * @returns {Promise<object|null>} { source, facts, created, age_hours } or null
 */
export async function getCachedFacts(source) {
    await ensureCacheDir();
    const files = await fs.readdir(CACHE_DIR);

    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
            const raw = await fs.readFile(path.join(CACHE_DIR, file), 'utf8');
            const entry = JSON.parse(raw);
            if (entry.source !== source) continue;
            if (new Date(entry.expires) < new Date()) {
                // Expired — delete and skip
                await fs.unlink(path.join(CACHE_DIR, file)).catch(() => {});
                continue;
            }
            const ageHours = (Date.now() - new Date(entry.created).getTime()) / 3600000;
            return { source: entry.source, facts: entry.facts, created: entry.created, age_hours: Math.round(ageHours * 10) / 10 };
        } catch { continue; }
    }
    return null;
}

/**
 * Search cached facts by keyword across all sources.
 * Returns matching facts from any non-expired cache entries.
 * @param {string} keyword - Search term (case-insensitive)
 * @returns {Promise<Array>} Array of { source, fact, age_hours }
 */
export async function searchCache(keyword) {
    await ensureCacheDir();
    const files = await fs.readdir(CACHE_DIR);
    const results = [];
    const kw = keyword.toLowerCase();

    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
            const raw = await fs.readFile(path.join(CACHE_DIR, file), 'utf8');
            const entry = JSON.parse(raw);
            if (new Date(entry.expires) < new Date()) {
                await fs.unlink(path.join(CACHE_DIR, file)).catch(() => {});
                continue;
            }
            const ageHours = (Date.now() - new Date(entry.created).getTime()) / 3600000;
            for (const fact of entry.facts) {
                const searchable = `${fact.topic} ${fact.value} ${fact.detail || ''}`.toLowerCase();
                if (searchable.includes(kw)) {
                    results.push({ source: entry.source, fact, age_hours: Math.round(ageHours * 10) / 10 });
                }
            }
        } catch { continue; }
    }
    return results;
}

/**
 * Clean expired entries from cache.
 */
export async function cleanExpired() {
    await ensureCacheDir();
    const files = await fs.readdir(CACHE_DIR);
    let cleaned = 0;

    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
            const raw = await fs.readFile(path.join(CACHE_DIR, file), 'utf8');
            const entry = JSON.parse(raw);
            if (new Date(entry.expires) < new Date()) {
                await fs.unlink(path.join(CACHE_DIR, file));
                cleaned++;
            }
        } catch { continue; }
    }
    return cleaned;
}

/**
 * Enforce the max entries cap — evict oldest entries.
 */
async function enforceCap() {
    const files = await fs.readdir(CACHE_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    if (jsonFiles.length <= MAX_ENTRIES) return;

    // Read all entries and sort by creation date (oldest first)
    const entries = [];
    for (const file of jsonFiles) {
        try {
            const raw = await fs.readFile(path.join(CACHE_DIR, file), 'utf8');
            const entry = JSON.parse(raw);
            entries.push({ file, created: new Date(entry.created).getTime() });
        } catch { continue; }
    }

    entries.sort((a, b) => a.created - b.created);
    const toRemove = entries.slice(0, entries.length - MAX_ENTRIES);

    for (const { file } of toRemove) {
        await fs.unlink(path.join(CACHE_DIR, file)).catch(() => {});
    }
}

/**
 * Get cache stats for monitoring.
 * @returns {Promise<object>} { entries, oldest_hours, newest_hours, total_facts }
 */
export async function getCacheStats() {
    await ensureCacheDir();
    const files = await fs.readdir(CACHE_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    let oldest = Date.now();
    let newest = 0;
    let totalFacts = 0;

    for (const file of jsonFiles) {
        try {
            const raw = await fs.readFile(path.join(CACHE_DIR, file), 'utf8');
            const entry = JSON.parse(raw);
            const created = new Date(entry.created).getTime();
            if (created < oldest) oldest = created;
            if (created > newest) newest = created;
            totalFacts += (entry.facts || []).length;
        } catch { continue; }
    }

    return {
        entries: jsonFiles.length,
        oldest_hours: jsonFiles.length > 0 ? Math.round((Date.now() - oldest) / 3600000 * 10) / 10 : 0,
        newest_hours: jsonFiles.length > 0 ? Math.round((Date.now() - newest) / 3600000 * 10) / 10 : 0,
        total_facts: totalFacts,
        max_entries: MAX_ENTRIES,
        ttl_hours: DEFAULT_TTL_HOURS,
    };
}
