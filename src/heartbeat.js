/**
 * Heartbeat system — scheduled tasks, cron loading, daily heartbeats
 */

import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import { WORKSPACE_PATH } from './config.js';

/**
 * Handle a scheduled task by calling the AI and optionally notifying via Telegram
 */
export async function handleScheduledTask(task, { callAnthropicQueued, processResponse, buildSystemPrompt, config, bot, TOOLS }) {
    try {
        const systemPrompt = await buildSystemPrompt();

        const response = await callAnthropicQueued({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 8192,
            system: systemPrompt,
            tools: TOOLS,
            messages: [{
                role: 'user',
                content: `[SCHEDULED TASK: ${task.name}]\n\n${task.task_description}\n\nExecute this task now and report results.`
            }]
        }, 1);

        const finalText = await processResponse(response, null, true, systemPrompt, 'claude-sonnet-4-20250514');

        if (config.telegram_notify_tasks && config.telegram_owner_id && finalText.trim()) {
            await bot.sendMessage(
                config.telegram_owner_id,
                `*${task.name}*\n\n${finalText.substring(0, 3500)}`,
                { parse_mode: 'Markdown' }
            );
        }
    } catch (error) {
        console.error(`[CRON] Task '${task.name}' failed:`, error.message);
    }
}

/**
 * Load saved scheduled tasks from disk
 */
export async function loadScheduledTasks(scheduledTasks, deps) {
    const tasksDir = path.join(WORKSPACE_PATH, 'tasks');
    try {
        await fs.mkdir(tasksDir, { recursive: true });
        const files = await fs.readdir(tasksDir);

        for (const file of files) {
            if (file.endsWith('.json')) {
                const taskData = JSON.parse(
                    await fs.readFile(path.join(tasksDir, file), 'utf-8')
                );

                const job = cron.schedule(taskData.cron_expression, async () => {
                    console.log(`[CRON] Running: ${taskData.name}`);
                    await handleScheduledTask(taskData, deps);
                });

                scheduledTasks.set(taskData.name, job);
                console.log(`[CRON] Loaded task: ${taskData.name}`);
            }
        }
    } catch (error) {
        console.error('[CRON] Error loading tasks:', error.message);
    }
}

/**
 * Setup built-in heartbeat cron jobs
 */
export function setupHeartbeat(deps) {
    const { memory } = deps;

    // 8am — Morning briefing
    cron.schedule('0 8 * * *', async () => {
        console.log('[HEARTBEAT] Morning briefing');
        await handleScheduledTask({
            name: 'morning-briefing',
            task_description: `Good morning Lee! Provide a morning briefing covering:
1. Any overnight developments in AI/robotics/African tech
2. Key economic indicators or market movements
3. Any tasks or deadlines coming up
4. Proactive suggestions based on recent conversations
5. Weather and any relevant news

Keep it concise but comprehensive. This is a daily routine.`
        }, deps);
    });

    // 11am + 4pm — Proactive scans
    cron.schedule('0 11,16 * * *', async () => {
        console.log('[HEARTBEAT] Proactive scan');
        try {
            const recentResearch = await memory.getMemory('research');
            const recentLines = recentResearch.split('\n').slice(-20).join('\n');

            await handleScheduledTask({
                name: 'proactive-scan',
                task_description: `Quick proactive scan — search for breaking news in AI, robotics, African tech, or global macro that Lee should know about RIGHT NOW.

Recent research context (avoid repeating):
${recentLines}

Rules:
- ONLY notify Lee if you find something genuinely new and important
- If nothing notable, just save a brief note to memory and do NOT send a Telegram message
- If you do find something, send a short, punchy update — 1-3 sentences max`
            }, deps);
        } catch (error) {
            console.error('[HEARTBEAT] Proactive scan failed:', error.message);
        }
    });

    // 1pm — Midday research
    cron.schedule('0 13 * * *', async () => {
        console.log('[HEARTBEAT] Midday research');
        await handleScheduledTask({
            name: 'midday-research',
            task_description: `Midday economic research for NAVADA VC:
1. Search for any new AI or robotics startup funding announcements
2. Check for African tech ecosystem news
3. Look for any regulatory or policy updates affecting tech investment
4. Monitor key economic indicators and currency movements
5. Identify 1-2 interesting startups worth deeper analysis

Save key findings to memory and provide a summary.`
        }, deps);
    });

    // 6pm — Evening summary
    cron.schedule('0 18 * * *', async () => {
        console.log('[HEARTBEAT] Evening summary');
        await handleScheduledTask({
            name: 'evening-summary',
            task_description: `Evening summary for Lee:
1. Key economic and market developments from today
2. Any action items that need attention
3. Tomorrow's priorities based on what we discussed
4. Any interesting opportunities or risks identified
5. Brief strategic reflection on portfolio and pipeline

End with a brief strategic reflection.`
        }, deps);
    });

    // 9pm — Daily wrap-up summary + email
    cron.schedule('0 21 * * *', async () => {
        console.log('[HEARTBEAT] Daily wrap-up (9pm)');
        await handleScheduledTask({
            name: 'daily-wrapup',
            task_description: `Daily wrap-up for NAVADA VC. Please:
1. Summarize today's key activities, findings, and market developments
2. List any outstanding action items or follow-ups
3. Highlight the most important insight or opportunity from today
4. Send a wrap-up email to Lee using the send_email tool with a clean HTML summary of the day
5. Keep the Telegram summary concise (5-10 bullet points max)

This is the end-of-day summary — make it comprehensive but scannable.`
        }, deps);
    });

    console.log('[HEARTBEAT] Scheduled: 8am briefing, 11am/4pm scans, 1pm research, 6pm summary, 9pm wrap-up (6 daily)');
}
