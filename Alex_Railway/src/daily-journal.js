/**
 * Daily Journal & Diary System
 * Captures all Q&A exchanges to dated daily files, maintains ALEX's progress diary,
 * and runs nightly churn to index into ChromaDB and archive.
 */

import fs from 'fs/promises';
import path from 'path';
import { WORKSPACE_PATH } from './config.js';

const DAILY_DIR = path.join(WORKSPACE_PATH, 'daily');
const DIARY_DIR = path.join(WORKSPACE_PATH, 'diary');
const ARCHIVE_DIR = path.join(WORKSPACE_PATH, 'archive');
const PROGRESS_FILE = path.join(DIARY_DIR, 'progress.txt');
const FACTS_FILE = path.join(DIARY_DIR, 'facts.json');

let redisRef = null;
let dbRef = null;

/**
 * Set Redis reference for cache operations.
 * Supports both @upstash/redis (set with { ex }) and node-redis (setEx).
 */
export function setJournalRedis(r) {
    redisRef = r;
}

/**
 * Set Postgres DB reference for persistence (optional).
 * Expected interface: { insertExchange: async (obj) => void }
 */
export function setJournalDb(db) {
    dbRef = db;
}

/**
 * Set a Redis key with TTL, compatible with both Upstash and node-redis clients
 */
async function redisSetEx(key, value, ttlSeconds) {
    if (!redisRef) return;
    // node-redis has setEx, Upstash uses set with { ex }
    if (typeof redisRef.setEx === 'function') {
        await redisRef.setEx(key, ttlSeconds, value);
    } else {
        await redisRef.set(key, value, { ex: ttlSeconds });
    }
}

/**
 * Initialize directories and ensure progress.txt exists
 */
export async function init() {
    await fs.mkdir(DAILY_DIR, { recursive: true });
    await fs.mkdir(DIARY_DIR, { recursive: true });
    await fs.mkdir(ARCHIVE_DIR, { recursive: true });
    try {
        await fs.access(PROGRESS_FILE);
    } catch {
        await fs.writeFile(PROGRESS_FILE, '');
    }
    console.log('[JOURNAL] Directories ready');
}

/**
 * Get today's month subfolder name: "Feb-2026"
 */
export function getTodayMonthFolder() {
    const now = new Date();
    const month = now.toLocaleDateString('en-GB', { month: 'short', timeZone: 'Europe/London' });
    const year = now.toLocaleDateString('en-GB', { year: 'numeric', timeZone: 'Europe/London' });
    return `${month}-${year}`;
}

/**
 * Get today's filename: "Friday-06-Feb-2026.md"
 * Files are stored inside month subfolders: daily/Feb-2026/Friday-06-Feb-2026.md
 */
export function getTodayFilename() {
    const now = new Date();
    const day = now.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/London' });
    const month = now.toLocaleDateString('en-GB', { month: 'short', timeZone: 'Europe/London' });
    const date = now.toLocaleDateString('en-GB', { day: '2-digit', timeZone: 'Europe/London' });
    const year = now.toLocaleDateString('en-GB', { year: 'numeric', timeZone: 'Europe/London' });
    return `${day}-${date}-${month}-${year}.md`;
}

/**
 * Get full path to today's daily file (creates month folder if needed)
 */
async function getTodayFilePath() {
    const monthDir = path.join(DAILY_DIR, getTodayMonthFolder());
    await fs.mkdir(monthDir, { recursive: true });
    return path.join(monthDir, getTodayFilename());
}

/**
 * Map model ID to human-readable label
 */
export function modelLabel(modelId) {
    if (!modelId) return 'Unknown';
    if (modelId.includes('haiku')) return 'Haiku';
    if (modelId.includes('sonnet')) return 'Sonnet';
    if (modelId.includes('opus')) return 'Opus';
    if (modelId.includes('deepseek')) return 'DeepSeek';
    if (modelId === 'o3') return 'o3';
    if (modelId === 'o4-mini') return 'o4-mini';
    if (modelId === 'gpt-5.2') return 'GPT-5.2';
    if (modelId === 'gpt-5.1') return 'GPT-5.1';
    if (modelId === 'gpt-5-nano') return 'GPT-5 Nano';
    if (modelId === 'gpt-5-mini') return 'GPT-5 Mini';
    if (modelId === 'gpt-5') return 'GPT-5';
    if (modelId.includes('gpt')) return 'GPT-4o';
    if (modelId.startsWith('kimi')) return 'Kimi K2';
    if (modelId.includes('gemini')) return 'Gemini';
    if (modelId.includes('llama')) return 'Llama';
    if (modelId.includes('mistral')) return 'Mistral';
    if (modelId.includes('qwen')) return 'Qwen';
    return modelId;
}

/**
 * Append a Q&A exchange to today's daily file.
 * Deduplicates by checking if the last line matches.
 */
export async function appendExchange({ question, answer, source, modelLabel: label, userName }) {
    const filePath = await getTodayFilePath();

    const qLine = `Q: ${userName || 'User'} - ${(question || '').replace(/\n/g, ' ').trim()}`;
    const aLine = `A: Alex (${label || 'Unknown'}) - ${(answer || '').replace(/\n/g, ' ').trim()}`;
    const entry = `${qLine}\n${aLine}\n`;

    // Simple dedup: check if the last Q line in file matches
    try {
        const existing = await fs.readFile(filePath, 'utf-8');
        const lines = existing.trimEnd().split('\n');
        const lastQLine = lines.filter(l => l.startsWith('Q: ')).pop();
        if (lastQLine && lastQLine === qLine) {
            return; // Duplicate — skip
        }
    } catch {
        // File doesn't exist yet — that's fine
    }

    await fs.appendFile(filePath, entry + '\n');

    // Update short cache (fire-and-forget)
    updateShortCache().catch(() => {});

    // Persist to Postgres (fire-and-forget)
    if (dbRef && typeof dbRef.insertExchange === 'function') {
        dbRef.insertExchange({
            source: source || 'unknown',
            user_name: userName || 'User',
            model_label: label || 'Unknown',
            question: question || '',
            answer: answer || '',
        }).catch(() => {});
    }
}

/**
 * Write a timestamped diary entry to progress.txt
 */
export async function writeDiaryEntry(action) {
    const now = new Date();
    const timestamp = now.toLocaleString('en-GB', {
        timeZone: 'Europe/London',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).replace(',', '');
    const line = `${timestamp} ${action}\n`;
    await fs.appendFile(PROGRESS_FILE, line);
}

/**
 * Write last 20 lines of today's daily file to Redis cache
 */
export async function updateShortCache() {
    if (!redisRef) return;
    try {
        const filePath = path.join(DAILY_DIR, getTodayMonthFolder(), getTodayFilename());
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.trim().split('\n');
        const last20 = lines.slice(-20).join('\n');
        await redisSetEx('cache:short:day', last20, 86400);
    } catch {
        // File may not exist yet
    }
}

/**
 * Read short cache from Redis (fallback: read today's file)
 */
export async function loadShortCache() {
    if (redisRef) {
        try {
            const cached = await redisRef.get('cache:short:day');
            if (cached) return cached;
        } catch {}
    }
    // Fallback: read today's file directly
    try {
        const filePath = path.join(DAILY_DIR, getTodayMonthFolder(), getTodayFilename());
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.trim().split('\n');
        return lines.slice(-20).join('\n');
    } catch {
        return '';
    }
}

/**
 * Get last 10 diary lines for system prompt injection
 */
export async function getDiaryContext() {
    try {
        const content = await fs.readFile(PROGRESS_FILE, 'utf-8');
        const lines = content.trim().split('\n').filter(l => l.trim());
        return lines.slice(-10).join('\n');
    } catch {
        return '';
    }
}

/**
 * Get last n lines from diary/progress.txt (for /read command)
 */
export async function getLastDailyLines(n = 5) {
    try {
        const content = await fs.readFile(PROGRESS_FILE, 'utf-8');
        const lines = content.trim().split('\n').filter(l => l.trim());
        return lines.slice(-n).join('\n') || '(No diary entries yet)';
    } catch {
        return '(No diary entries yet)';
    }
}

/**
 * Dump full conversation to today's daily file (for /save command)
 */
export async function forceSaveChat(chatId, memory) {
    try {
        const conv = await memory.getConversation(chatId);
        if (!conv.messages || conv.messages.length === 0) {
            return 'No conversation to save.';
        }

        const filename = getTodayFilename();
        const filePath = await getTodayFilePath();

        let saved = 0;
        for (const msg of conv.messages) {
            const role = msg.role === 'user' ? 'Q' : 'A';
            let text = '';
            if (typeof msg.content === 'string') {
                text = msg.content;
            } else if (Array.isArray(msg.content)) {
                text = msg.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
            }
            if (!text.trim()) continue;
            const line = `${role}: ${text.replace(/\n/g, ' ').substring(0, 500).trim()}\n`;
            await fs.appendFile(filePath, line);
            saved++;
        }

        return `Saved ${saved} messages to ${filename}`;
    } catch (err) {
        return `Save failed: ${err.message}`;
    }
}

/**
 * 2 AM nightly churn: index daily files to ChromaDB, extract facts, archive
 */
export async function runChurn(callAnthropicQueued) {
    console.log('[CHURN] Starting nightly journal churn...');
    const { execFile: execFileCb } = await import('child_process');
    const { promisify } = await import('util');
    const execFile = promisify(execFileCb);
    const scriptPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'Alex-Scripts', 'rag_manager.py');

    // 1. Index all daily/{month}/*.md files to ChromaDB
    let indexedFiles = 0;
    const allMdFiles = []; // { relPath, fullPath } for archiving
    try {
        const monthDirs = await fs.readdir(DAILY_DIR);
        for (const monthDir of monthDirs) {
            const monthPath = path.join(DAILY_DIR, monthDir);
            const stat = await fs.stat(monthPath).catch(() => null);
            if (!stat || !stat.isDirectory()) continue;
            const files = await fs.readdir(monthPath);
            const mdFiles = files.filter(f => f.endsWith('.md'));
            for (const file of mdFiles) {
                const fullPath = path.join(monthPath, file);
                allMdFiles.push({ relPath: `${monthDir}/${file}`, fullPath });
                try {
                    const content = await fs.readFile(fullPath, 'utf-8');
                    if (content.trim().length < 50) continue;
                    const { stdout } = await execFile('python3', [
                        scriptPath, 'index-text',
                        '--source', `daily:${monthDir}/${file}`,
                        '--collection', 'daily_memories',
                        '--chunk-size', '350',
                        '--chunk-overlap', '80',
                        '--ttl', '30',
                    ], { input: content, timeout: 60000 });
                    console.log(`[CHURN] Indexed ${monthDir}/${file}: ${stdout.trim()}`);
                    indexedFiles++;
                } catch (err) {
                    console.error(`[CHURN] Failed to index ${monthDir}/${file}:`, err.message);
                }
            }
        }
    } catch (err) {
        console.error('[CHURN] Daily file indexing failed:', err.message);
    }

    // 2. Extract facts from diary using Haiku
    let factsExtracted = 0;
    if (callAnthropicQueued) {
        try {
            const diaryContent = await fs.readFile(PROGRESS_FILE, 'utf-8');
            if (diaryContent.trim().length > 50) {
                const result = await callAnthropicQueued({
                    model: 'claude-3-5-haiku-20241022',
                    max_tokens: 800,
                    messages: [{
                        role: 'user',
                        content: `Extract key tasks and outcomes from this diary log. Return a JSON array of objects with: task (string), status (completed/failed/pending), detail (brief context). Return ONLY the JSON array.\n\n${diaryContent.substring(0, 4000)}`
                    }]
                }, 0, { source: 'churn-fact-extraction' });

                const factText = result?.content?.[0]?.text || '';
                const jsonMatch = factText.match(/\[[\s\S]*\]/) || [null];
                if (jsonMatch[0]) {
                    const facts = JSON.parse(jsonMatch[0]);
                    if (Array.isArray(facts)) {
                        await fs.writeFile(FACTS_FILE, JSON.stringify(facts, null, 2));
                        factsExtracted = facts.length;
                        console.log(`[CHURN] Extracted ${facts.length} facts from diary`);

                        // Push to Redis long cache
                        if (redisRef) {
                            await redisSetEx('cache:long:week', JSON.stringify(facts), 604800).catch(() => {});
                        }
                    }
                }
            }
        } catch (err) {
            console.error('[CHURN] Fact extraction failed:', err.message);
        }
    }

    // 3. Archive daily files (from month subdirectories)
    let archivedFiles = 0;
    try {
        if (allMdFiles.length > 0) {
            const dateStr = new Date().toISOString().split('T')[0];
            const archiveName = `weekly-${dateStr}.tar.gz`;
            const archivePath = path.join(ARCHIVE_DIR, archiveName);
            const { exec: execCb } = await import('child_process');
            const execAsync = promisify(execCb);
            const relPaths = allMdFiles.map(f => f.relPath).join(' ');
            await execAsync(`tar -czf "${archivePath}" -C "${DAILY_DIR}" ${relPaths}`, { timeout: 30000 });
            // Delete originals after successful archive
            for (const { fullPath } of allMdFiles) {
                await fs.unlink(fullPath).catch(() => {});
            }
            archivedFiles = allMdFiles.length;
            console.log(`[CHURN] Archived ${allMdFiles.length} files to ${archiveName}`);
        }
    } catch (err) {
        console.error('[CHURN] Archiving failed:', err.message);
    }

    // 4. Clean expired daily_memories from ChromaDB
    try {
        await execFile('python3', [scriptPath, 'cleanup', '--collection', 'daily_memories'], { timeout: 30000 });
    } catch (err) {
        console.error('[CHURN] ChromaDB cleanup failed:', err.message);
    }

    // 5. Clear progress.txt (start fresh for next cycle)
    try {
        await fs.writeFile(PROGRESS_FILE, '');
    } catch {}

    console.log(`[CHURN] Complete — indexed:${indexedFiles} facts:${factsExtracted} archived:${archivedFiles}`);
}
