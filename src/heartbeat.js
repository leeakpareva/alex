/**
 * Heartbeat system — task definitions and execution helpers
 * Scheduling is handled by system cron (/etc/cron.d/alex), not node-cron.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { WORKSPACE_PATH } from './config.js';
import { archiveOldDone } from './email-filing.js';
import { cacheFacts, cleanExpired as cleanCache } from './content-cache.js';
import { writeDiaryEntry } from './daily-journal.js';
import { runRalphReview } from './ralph.js';

// dashPost is set by gateway.js via setDashPost()
let dashPost = () => {};
let redisRef = null;

export function setDashPost(fn) { dashPost = fn; }
export function setRedis(r) { redisRef = r; }

// Anti-repetition: track recent output hashes (4-hour window)
const recentOutputHashes = new Map();
const DEDUP_WINDOW_MS = 4 * 3600 * 1000;

/**
 * Check if task output is a repeat of recent output (anti-repetition)
 * Uses MD5 of first 500 chars with a 4-hour sliding window.
 */
export function isRepeatOutput(taskName, text) {
    const now = Date.now();
    // Lazy cleanup of stale entries
    for (const [key, ts] of recentOutputHashes) {
        if (now - ts > DEDUP_WINDOW_MS) recentOutputHashes.delete(key);
    }
    const hash = crypto.createHash('md5').update(text.substring(0, 500)).digest('hex');
    const key = `${taskName}:${hash}`;
    if (recentOutputHashes.has(key)) return true;
    recentOutputHashes.set(key, now);
    return false;
}

/**
 * Save full task output to ~/.alex/tasks/outputs/{Mon-YYYY}/{taskName}-{HH-MM}.md
 */
async function saveTaskOutput(taskName, model, text) {
    const now = new Date();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthFolder = `${monthNames[now.getMonth()]}-${now.getFullYear()}`;
    const dir = path.join(WORKSPACE_PATH, 'tasks', 'outputs', monthFolder);
    await fs.mkdir(dir, { recursive: true });

    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const filename = `${taskName}-${hh}-${mm}.md`;
    const title = taskName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const content = `# ${title}\n**Date:** ${now.toISOString()}\n**Model:** ${model}\n---\n\n${text}\n`;

    const filePath = path.join(dir, filename);
    await fs.writeFile(filePath, content);
    await fs.chmod(filePath, 0o600);
    console.log(`[HEARTBEAT] Saved task output: ${monthFolder}/${filename}`);
}

/**
 * Built-in heartbeat task definitions — looked up by the /api/trigger endpoint
 */
export const BUILTIN_TASKS = new Map([
    ['morning-briefing', {
        name: 'morning-briefing',
        task_description: `Good morning Lee! Provide a morning briefing covering:
1. Any overnight developments in AI/robotics/African tech
2. Key economic indicators or market movements
3. Weather in London today (use bash: curl -s 'wttr.in/London?format=3')
4. Today's scheduled tasks (list any user-created tasks due today)
5. Tracked stock movements — check any stocks mentioned in recent memory
6. Inbox status — how many emails need attention
7. Proactive suggestions based on recent conversations

Keep it concise but comprehensive. This is a daily routine.`
    }],
    ['midmorning-checkin', {
        name: 'midmorning-checkin',
        task_description: `Hey Lee, checking in — anything you need me to look into today? I'll share one quick update from my morning scan and flag anything worth your attention. If you have tasks, emails to draft, or research topics, just let me know.`
    }],
    ['midday-research', {
        name: 'midday-research',
        task_description: `Midday economic research for NAVADA:
1. Search for any new AI or robotics startup funding announcements
2. Check for African tech ecosystem news
3. Look for any regulatory or policy updates affecting tech investment
4. Monitor key economic indicators and currency movements
5. Identify 1-2 interesting startups worth deeper analysis

Save key findings to memory and provide a summary.`
    }],
    ['afternoon-checkin', {
        name: 'afternoon-checkin',
        task_description: `Afternoon check-in. Quick summary of what I've covered today and anything still in progress. Any emails to draft, research to kick off for tomorrow, or things to follow up on before end of day? I'm here.`
    }],
    ['evening-summary', {
        name: 'evening-summary',
        task_description: `Evening summary for Lee:
1. Key economic and market developments from today
2. Any action items that need attention
3. Tomorrow's priorities based on what we discussed
4. Any interesting opportunities or risks identified
5. Brief strategic reflection on portfolio and pipeline

End with a brief strategic reflection.`
    }],
    ['inbox-review', {
        name: 'inbox-review',
        task_description: `Review the email inbox filing system at ~/.alex/inbox/emails.json.
1. Check for not_started emails older than 4 hours — send Lee a reminder on Telegram
2. Check for in_progress emails with no activity for 24 hours — nudge Lee
3. If any emails have can_handle_autonomously=true and are still not_started, propose handling them
4. Send Lee a brief inbox status summary via Telegram`
    }],
    ['stock-alerts', {
        name: 'stock-alerts',
        task_description: `Check stock alert thresholds defined in ~/.alex/alerts.json.

1. Read the alerts config file
2. For each stock alert, use stock_quote to get the current price
3. If price exceeds the 'above' threshold or drops below the 'below' threshold, send Lee a Telegram alert
4. Only alert once per threshold breach per 24 hours (check ~/.alex/alerts-state.json)

If no alerts are configured, skip silently.`
    }],
    ['check-followups', {
        name: 'check-followups',
        task_description: `Review the tasks memory (memory_recall category: tasks) for any deadlines, reminders, or follow-ups that are due today or overdue.

1. Read the tasks memory for items containing dates, deadlines, or "remind" keywords
2. Check if any are due today or past due
3. If found, send Lee a Telegram reminder summarising what's due
4. If nothing is due, skip silently (no message needed)

Be proactive but not noisy — only message if there's something actionable.`
    }],
    ['daily-churn', {
        name: 'daily-churn',
        task_description: 'Nightly journal churn: index daily files to ChromaDB, extract facts from diary, archive and clear daily files.'
    }],
    ['api-data-refresh', {
        name: 'api-data-refresh',
        task_description: `Refresh API data for the alexnavada.xyz API Library. This provides educational API data to users.

For each category below, use your available tools (web_search, stock_quote, crypto_rate, etc.) to fetch fresh data, then save a JSON summary for each endpoint to Redis.

Categories to refresh:
1. Finance: stock-quote (AAPL, MSFT, GOOGL), crypto-rate (BTC, ETH), forex-rate (USD/GBP, EUR/USD), market-news, commodity-price (gold, oil)
2. News: news-headlines (top 5 world headlines)
3. Space: space-facts (random interesting fact)

For each endpoint, use memory_save to store the data with category "api-data" so it persists.
Then use bash to push the data to Redis via curl:
curl -s -X POST "https://alexnavada.xyz/api/push" -H "Authorization: Bearer $PUSH_SECRET" -H "Content-Type: application/json" -d '{"api_data": {"endpoint_name": data}}'

Focus on the financial endpoints first as those are most time-sensitive. Static endpoints (periodic-table, country-info, unit-convert, time-zones, lorem-ipsum) only need refreshing weekly.`
    }],
    ['weekly-self-review', {
        name: 'weekly-self-review',
        task_description: `Weekly self-improvement review. Analyse your own performance this week:

1. Read your token logs from the past 7 days — are you using the right models? Could you route more queries to Haiku to save costs?
2. Review your memory files — is knowledge growing? Are there stale entries to clean up?
3. Check your skills — should any new skills be created based on recurring requests?
4. Review dashboard data quality — are all sections being updated properly?
5. Check for any errors in gateway.log from the past week
6. Read recent user feedback from ~/.alex/logs/feedback/ — what does Lee find valuable vs useless?
7. Read Ralph's recent fix proposals from ~/.alex/fixes/ — have any been addressed?
8. Suggest 2-3 concrete improvements you could make to yourself

Save your findings to memory under 'knowledge' and send a summary to Lee.
This is your chance to evolve and get better each week.`
    }],
    ['ralph-review', {
        name: 'ralph-review',
        task_description: 'Ralph self-improvement engine: analyse diary and feedback, identify failures, propose fixes.'
    }],
]);

/**
 * Handle a scheduled task by calling the AI and optionally notifying via Telegram
 */
// Tasks that need Sonnet's reasoning — complex research, multi-step analysis, strategic thinking
const SONNET_TASKS = new Set(['morning-briefing', 'midday-research', 'evening-summary', 'weekly-self-review']);

export async function handleScheduledTask(task, { callAnthropicQueued, processResponse, buildSystemPrompt, config, bot, TOOLS, memory }) {
    try {
        const systemPrompt = await buildSystemPrompt();

        // Route to Haiku for simple tasks (stock checks, inbox review, followups) — 4x cheaper
        const useSonnet = SONNET_TASKS.has(task.name);
        const model = useSonnet ? 'claude-sonnet-4-20250514' : 'claude-3-5-haiku-20241022';
        const maxTokens = useSonnet ? 16384 : 8192;

        // Add cache_control to last tool for prompt caching
        const cachedTools = TOOLS.map((tool, i) =>
            i === TOOLS.length - 1 ? { ...tool, cache_control: { type: 'ephemeral' } } : tool
        );

        const response = await callAnthropicQueued({
            model,
            max_tokens: maxTokens,
            system: systemPrompt,
            tools: cachedTools,
            messages: [{
                role: 'user',
                content: `[SCHEDULED TASK: ${task.name}]\n\n${task.task_description}\n\nExecute this task now and report results.`
            }]
        }, 1, { source: 'scheduled', taskName: task.name });

        const finalText = await processResponse(response, null, true, systemPrompt, model);

        // Extract and cache key facts from the output (fire-and-forget)
        if (finalText.length > 200) {
            try {
                const factResult = await callAnthropicQueued({
                    model: 'claude-3-5-haiku-20241022',
                    max_tokens: 500,
                    messages: [{ role: 'user', content: `Extract the key data points from this AI agent output as a JSON array. Each item should have: topic (what it's about), value (the number/data), detail (brief context). Only include concrete facts with numbers or specific data. Return ONLY the JSON array, no explanation.\n\nOutput:\n${finalText.substring(0, 3000)}` }]
                }, 0, { source: 'fact-extraction-cache' });
                const factText = factResult?.content?.[0]?.text || '';
                const jsonMatch = factText.match(/\[[\s\S]*\]/) || [null];
                if (jsonMatch[0]) {
                    const facts = JSON.parse(jsonMatch[0]);
                    if (Array.isArray(facts) && facts.length > 0) {
                        const ttl = task.name.includes('stock') ? 6 : 24;
                        await cacheFacts(task.name, facts, ttl);
                    }
                }
            } catch {}
        }

        // Save full task output to disk (fire-and-forget, always runs regardless of dedup)
        if (finalText.trim()) {
            saveTaskOutput(task.name, model, finalText).catch(err =>
                console.error(`[HEARTBEAT] Failed to save task output:`, err.message));
        }

        // Distill key learnings into KNOWLEDGE.md (long-term memory)
        if (finalText.length > 200 && memory) {
            try {
                const distillResult = await callAnthropicQueued({
                    model: 'claude-3-5-haiku-20241022',
                    max_tokens: 400,
                    messages: [{ role: 'user', content: `Extract 1-3 key learnings worth remembering long-term from this task output. Focus on facts, trends, or insights that would be useful weeks or months from now. If nothing is novel or worth long-term retention, return exactly "None".\n\nTask: ${task.name}\nOutput:\n${finalText.substring(0, 3000)}` }]
                }, 0, { source: 'knowledge-distill' });
                const learnings = distillResult?.content?.[0]?.text || '';
                if (learnings.trim() && learnings.trim().toLowerCase() !== 'none') {
                    await memory.appendKnowledge(`[${task.name}] ${learnings.trim()}`);
                    console.log(`[HEARTBEAT] Distilled knowledge from ${task.name}`);
                }
            } catch (err) {
                console.error(`[HEARTBEAT] Knowledge distillation failed:`, err.message);
            }
        }

        // Check for repeat output (anti-repetition)
        const isDuplicate = finalText.trim() && isRepeatOutput(task.name, finalText);

        // Update dashboard with task result
        dashPost('add_task', { task: { name: task.name, category: 'heartbeat', status: 'completed', time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) + ' GMT' } });
        dashPost('add_activity', { entry: `Heartbeat: ${task.name} completed` });
        writeDiaryEntry(`${task.name} completed`).catch(() => {});

        // Post findings as news if substantive
        if (finalText.length > 100) {
            dashPost('add_news', { item: { headline: task.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), summary: finalText.substring(0, 200), severity: 'info', source: 'heartbeat' } });
        }

        if (config.telegram_notify_tasks && config.telegram_owner_id && finalText.trim() && bot) {
            const taskTitle = task.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            // Feedback buttons for heartbeat messages
            const feedbackButtons = {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '\ud83d\udc4d', callback_data: `fb_good_${task.name}` },
                        { text: '\ud83d\udc4e', callback_data: `fb_bad_${task.name}` },
                    ]]
                }
            };
            if (isDuplicate) {
                // Skip sending full output if it's a repeat within the dedup window
                console.log(`[HEARTBEAT] Dedup: suppressed repeat output for ${task.name}`);
                await bot.sendMessage(config.telegram_owner_id, `<b>${taskTitle}</b>\n\n<i>No significant new updates since last run.</i>`, { parse_mode: 'HTML' });
            } else {
                const msgText = `<b>${taskTitle}</b>\n\n${finalText.substring(0, 3500)}`;
                try {
                    await bot.sendMessage(config.telegram_owner_id, msgText, { parse_mode: 'HTML', ...feedbackButtons });
                } catch (parseErr) {
                    // HTML parse failed — send as plain text with buttons
                    await bot.sendMessage(config.telegram_owner_id, `${taskTitle}\n\n${finalText.substring(0, 3500)}`, feedbackButtons);
                }
            }
        }

        // Queue message for ALEX Terminal if it's active
        if (finalText.trim()) {
            const markerPath = path.join(os.homedir(), '.alex', 'terminal-active');
            const queuePath = path.join(os.homedir(), '.alex', 'terminal-queue.json');
            try {
                await fs.access(markerPath);
                const taskTitle = task.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                let queue = [];
                try {
                    queue = JSON.parse(await fs.readFile(queuePath, 'utf8'));
                } catch {}
                queue.push({ title: taskTitle, body: finalText.substring(0, 3500), time: new Date().toISOString() });
                await fs.writeFile(queuePath, JSON.stringify(queue));
            } catch {}
        }
    } catch (error) {
        console.error(`[CRON] Task '${task.name}' failed:`, error.message);
        dashPost('add_task', { task: { name: task.name, category: 'heartbeat', status: 'failed', time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) + ' GMT' } });
        writeDiaryEntry(`${task.name} FAILED: ${error.message}`).catch(() => {});
    }
}

/**
 * Hourly dashboard metrics sync (non-AI, lightweight)
 * Pushes tokens + commits directly to Redis, updates in-memory dash state
 */
export async function runDashboardSync() {
    console.log('[HEARTBEAT] Dashboard sync');
    try {
        const { exec: execCb } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(execCb);

        // Services check
        const alexActive = await execAsync('systemctl is-active alex.service').then(() => 'online').catch(() => 'offline');
        dashPost('update_services', { services: [
            { name: 'ALEX Gateway', port: 'systemd', status: alexActive },
            { name: 'Upstash Redis', port: 'cloud', status: 'online' },
            { name: 'Telegram Bot', port: 'polling', status: alexActive },
        ]});
        dashPost('set_status', { status: alexActive });

        // Token metrics from today's log
        const date = new Date().toISOString().split('T')[0];
        const logFile = path.join(WORKSPACE_PATH, 'logs', 'tokens', `tokens_${date}.jsonl`);
        let totalIn = 0, totalOut = 0, totalCalls = 0, totalCostUsd = 0;
        const byModel = {};
        try {
            const content = await fs.readFile(logFile, 'utf-8');
            for (const line of content.split('\n')) {
                if (!line.trim()) continue;
                const e = JSON.parse(line);
                const inp = e.input_tokens || 0, out = e.output_tokens || 0;
                totalIn += inp;
                totalOut += out;
                totalCalls++;
                let costUsd = 0;
                let modelName = 'Sonnet';
                const m = e.model || '';
                if (m.includes('haiku')) { costUsd = inp / 1e6 * 0.8 + out / 1e6 * 4; modelName = 'Haiku'; }
                else if (m === 'kimi-k2-thinking') { costUsd = inp / 1e6 * 1.0 + out / 1e6 * 4.0; modelName = 'Kimi K2 Think'; }
                else if (m.startsWith('kimi')) { costUsd = inp / 1e6 * 0.5 + out / 1e6 * 2.0; modelName = 'Kimi K2'; }
                else if (m.includes('deepseek')) { costUsd = inp / 1e6 * 0.14 + out / 1e6 * 0.28; modelName = 'DeepSeek'; }
                else if (m === 'o3') { costUsd = inp / 1e6 * 10 + out / 1e6 * 40; modelName = 'o3'; }
                else if (m === 'o4-mini') { costUsd = inp / 1e6 * 1.1 + out / 1e6 * 4.4; modelName = 'o4-mini'; }
                else if (m === 'gpt-4.1-nano') { costUsd = inp / 1e6 * 0.1 + out / 1e6 * 0.4; modelName = 'GPT-4.1 Nano'; }
                else if (m === 'gpt-4.1-mini') { costUsd = inp / 1e6 * 0.4 + out / 1e6 * 1.6; modelName = 'GPT-4.1 Mini'; }
                else if (m === 'gpt-4.1') { costUsd = inp / 1e6 * 2 + out / 1e6 * 8; modelName = 'GPT-4.1'; }
                else if (m === 'gpt-5') { costUsd = inp / 1e6 * 1.25 + out / 1e6 * 10; modelName = 'GPT-5'; }
                else if (m === 'gpt-5-mini') { costUsd = inp / 1e6 * 0.25 + out / 1e6 * 2; modelName = 'GPT-5 Mini'; }
                else if (m === 'gpt-5-nano') { costUsd = inp / 1e6 * 0.05 + out / 1e6 * 0.4; modelName = 'GPT-5 Nano'; }
                else if (m === 'gpt-5.1') { costUsd = inp / 1e6 * 1.25 + out / 1e6 * 10; modelName = 'GPT-5.1'; }
                else if (m === 'gpt-5.2') { costUsd = inp / 1e6 * 1.75 + out / 1e6 * 14; modelName = 'GPT-5.2'; }
                else if (m.includes('gpt')) { costUsd = inp / 1e6 * 2.5 + out / 1e6 * 10; modelName = 'GPT-4o'; }
                else if (m.includes('sonnet')) { costUsd = inp / 1e6 * 3 + out / 1e6 * 15; }
                else { costUsd = inp / 1e6 * 0.8 + out / 1e6 * 4; }
                totalCostUsd += costUsd;
                if (!byModel[modelName]) byModel[modelName] = { model: modelName, calls: 0, input_tokens: 0, output_tokens: 0, cost_gbp: 0 };
                byModel[modelName].calls++;
                byModel[modelName].input_tokens += inp;
                byModel[modelName].output_tokens += out;
                byModel[modelName].cost_gbp += costUsd * 0.79;
            }
        } catch {}

        const totalTokens = totalIn + totalOut;
        const totalCostGbp = totalCostUsd * 0.79;

        dashPost('update_metrics', { metrics: {
            total_tokens: totalTokens,
            total_api_calls: totalCalls,
            est_session_cost: `£${totalCostGbp.toFixed(4)}`,
            avg_tokens_per_task: totalCalls ? Math.round(totalTokens / totalCalls) : 0,
        }});

        // Push token stats to Redis (dash:tokens)
        if (redisRef) {
            const tokenData = {
                date,
                total_input_tokens: totalIn,
                total_output_tokens: totalOut,
                total_tokens: totalTokens,
                total_calls: totalCalls,
                total_cost_gbp: totalCostGbp,
                total_cost_usd: totalCostUsd,
                avg_cost_per_task_gbp: totalCalls ? totalCostGbp / totalCalls : 0,
                by_model: Object.values(byModel),
            };
            await redisRef.set('dash:tokens', JSON.stringify(tokenData)).catch(e => console.error('[DASH] tokens push failed:', e.message));

            // Git commits
            try {
                const { stdout } = await execAsync('git log --max-count=30 --format="%H|%h|%s|%an|%aI|%D"', { cwd: '/home/head/navada-1' });
                const commits = stdout.trim().split('\n').filter(l => l).map(line => {
                    const [hash, short_hash, message, author, date, refs] = line.split('|');
                    return { hash, short_hash, message, author, date, refs: refs || '' };
                });
                await redisRef.set('dash:commits', JSON.stringify({ commits })).catch(e => console.error('[DASH] commits push failed:', e.message));
            } catch (gitErr) {
                console.error('[DASH] git log failed:', gitErr.message);
            }
        }
    } catch (err) {
        console.error('[HEARTBEAT] Dashboard sync failed:', err.message);
    }
}

/**
 * Memory cleanup — clean up old conversations and stale knowledge
 */
export async function runCleanup(memory) {
    console.log('[CLEANUP] Running conversation cleanup');
    try {
        await memory.cleanupOldConversations();
    } catch (err) {
        console.error('[CLEANUP]', err.message);
    }
    // Prune old done emails
    try {
        await archiveOldDone();
    } catch (err) {
        console.error('[CLEANUP] Email archive failed:', err.message);
    }
    // Prune knowledge entries older than 180 days (decay < 0.14)
    try {
        await pruneOldKnowledge(memory);
    } catch (err) {
        console.error('[CLEANUP] Knowledge prune failed:', err.message);
    }
    // Clean expired content cache entries
    try {
        const cleaned = await cleanCache();
        if (cleaned > 0) console.log(`[CLEANUP] Cleaned ${cleaned} expired cache entries`);
    } catch (err) {
        console.error('[CLEANUP] Cache cleanup failed:', err.message);
    }
    // Purge task output files older than 3 days
    try {
        const outputsDir = path.join(WORKSPACE_PATH, 'tasks', 'outputs');
        const cutoff = Date.now() - 3 * 24 * 3600 * 1000;
        let purged = 0;
        const months = await fs.readdir(outputsDir).catch(() => []);
        for (const month of months) {
            const monthDir = path.join(outputsDir, month);
            const stat = await fs.stat(monthDir).catch(() => null);
            if (!stat?.isDirectory()) continue;
            const files = await fs.readdir(monthDir).catch(() => []);
            for (const file of files) {
                if (!file.endsWith('.md')) continue;
                const filePath = path.join(monthDir, file);
                const fstat = await fs.stat(filePath).catch(() => null);
                if (fstat && fstat.mtimeMs < cutoff) {
                    await fs.unlink(filePath);
                    purged++;
                }
            }
            // Remove empty month directories
            const remaining = await fs.readdir(monthDir).catch(() => ['x']);
            if (remaining.length === 0) await fs.rmdir(monthDir).catch(() => {});
        }
        if (purged > 0) console.log(`[CLEANUP] Purged ${purged} task output files older than 3 days`);
    } catch (err) {
        console.error('[CLEANUP] Task output purge failed:', err.message);
    }
    // Clean expired RAG entries (TTL-based document chunks)
    try {
        const { execFile: execFileCb } = await import('child_process');
        const scriptPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'scripts', 'rag_manager.py');
        execFileCb('python3', [scriptPath, 'cleanup'], { timeout: 30000 }, (err, stdout) => {
            if (stdout?.trim()) console.log(`[CLEANUP] RAG: ${stdout.trim()}`);
            if (err) console.error('[CLEANUP] RAG cleanup failed:', err.message);
        });
    } catch (err) {
        console.error('[CLEANUP] RAG cleanup failed:', err.message);
    }
}

/**
 * Prune knowledge entries older than 180 days
 */
async function pruneOldKnowledge(memory) {
    const knowledgePath = path.join(WORKSPACE_PATH, 'KNOWLEDGE.md');
    const content = await fs.readFile(knowledgePath, 'utf-8');
    const sections = content.split(/\n(?=## )/).filter(s => s.trim());

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 180);

    let prunedCount = 0;
    const kept = sections.filter(section => {
        const dateMatch = section.match(/## \[(\d{4}-\d{2}-\d{2})\]/);
        if (!dateMatch) return true; // Keep non-dated sections (headers etc)
        const sectionDate = new Date(dateMatch[1]);
        if (sectionDate < cutoff) {
            prunedCount++;
            return false;
        }
        return true;
    });

    if (prunedCount > 0) {
        await fs.writeFile(knowledgePath, kept.join('\n'));
        await fs.chmod(knowledgePath, 0o600);
        console.log(`[CLEANUP] Pruned ${prunedCount} knowledge entries older than 180 days`);
    }
}
