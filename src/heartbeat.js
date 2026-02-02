/**
 * Heartbeat system — task definitions and execution helpers
 * Scheduling is handled by system cron (/etc/cron.d/alex), not node-cron.
 */

import fs from 'fs/promises';
import path from 'path';
import { WORKSPACE_PATH } from './config.js';
import { archiveOldDone } from './email-filing.js';

// dashPost is set by gateway.js via setDashPost()
let dashPost = () => {};
let redisRef = null;

export function setDashPost(fn) { dashPost = fn; }
export function setRedis(r) { redisRef = r; }

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
    ['weekly-self-review', {
        name: 'weekly-self-review',
        task_description: `Weekly self-improvement review. Analyse your own performance this week:

1. Read your token logs from the past 7 days — are you using the right models? Could you route more queries to Haiku to save costs?
2. Review your memory files — is knowledge growing? Are there stale entries to clean up?
3. Check your skills — should any new skills be created based on recurring requests?
4. Review dashboard data quality — are all sections being updated properly?
5. Check for any errors in gateway.log from the past week
6. Suggest 2-3 concrete improvements you could make to yourself

Save your findings to memory under 'knowledge' and send a summary to Lee.
This is your chance to evolve and get better each week.`
    }],
]);

/**
 * Handle a scheduled task by calling the AI and optionally notifying via Telegram
 */
export async function handleScheduledTask(task, { callAnthropicQueued, processResponse, buildSystemPrompt, config, bot, TOOLS }) {
    try {
        const systemPrompt = await buildSystemPrompt();

        const response = await callAnthropicQueued({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 16384,
            system: systemPrompt,
            tools: TOOLS,
            messages: [{
                role: 'user',
                content: `[SCHEDULED TASK: ${task.name}]\n\n${task.task_description}\n\nExecute this task now and report results.`
            }]
        }, 1, { source: 'scheduled', taskName: task.name });

        const finalText = await processResponse(response, null, true, systemPrompt, 'claude-sonnet-4-20250514');

        // Update dashboard with task result
        dashPost('add_task', { task: { name: task.name, category: 'heartbeat', status: 'completed', time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) + ' GMT' } });
        dashPost('add_activity', { entry: `Heartbeat: ${task.name} completed` });

        // Post findings as news if substantive
        if (finalText.length > 100) {
            dashPost('add_news', { item: { headline: task.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), summary: finalText.substring(0, 200), severity: 'info', source: 'heartbeat' } });
        }

        if (config.telegram_notify_tasks && config.telegram_owner_id && finalText.trim() && bot) {
            const taskTitle = task.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const msgText = `<b>${taskTitle}</b>\n\n${finalText.substring(0, 3500)}`;
            try {
                await bot.sendMessage(config.telegram_owner_id, msgText, { parse_mode: 'HTML' });
            } catch (parseErr) {
                // HTML parse failed — send as plain text
                await bot.sendMessage(config.telegram_owner_id, `${taskTitle}\n\n${finalText.substring(0, 3500)}`);
            }
        }
    } catch (error) {
        console.error(`[CRON] Task '${task.name}' failed:`, error.message);
        dashPost('add_task', { task: { name: task.name, category: 'heartbeat', status: 'failed', time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) + ' GMT' } });
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
                else if (m.includes('deepseek')) { costUsd = inp / 1e6 * 0.14 + out / 1e6 * 0.28; modelName = 'DeepSeek'; }
                else if (m === 'o3') { costUsd = inp / 1e6 * 10 + out / 1e6 * 40; modelName = 'o3'; }
                else if (m === 'o4-mini') { costUsd = inp / 1e6 * 1.1 + out / 1e6 * 4.4; modelName = 'o4-mini'; }
                else if (m === 'gpt-4.1-nano') { costUsd = inp / 1e6 * 0.1 + out / 1e6 * 0.4; modelName = 'GPT-4.1 Nano'; }
                else if (m === 'gpt-4.1-mini') { costUsd = inp / 1e6 * 0.4 + out / 1e6 * 1.6; modelName = 'GPT-4.1 Mini'; }
                else if (m === 'gpt-4.1') { costUsd = inp / 1e6 * 2 + out / 1e6 * 8; modelName = 'GPT-4.1'; }
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
 * Memory cleanup — clean up old conversations
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
}
