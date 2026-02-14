/**
 * Railway-compatible task scheduler
 * Uses node-cron to run scheduled tasks within the main process
 */

import cron from 'node-cron';
import fetch from 'node-fetch';

const ALEX_PORT = process.env.ALEX_PORT || '9090';
const BASE_URL = `http://127.0.0.1:${ALEX_PORT}`;

// Track scheduled jobs
const scheduledJobs = new Map();

/**
 * Trigger a task via the API
 */
async function triggerTask(taskName) {
    try {
        console.log(`[SCHEDULER] Triggering task: ${taskName}`);

        const response = await fetch(`${BASE_URL}/api/trigger`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task: taskName }),
            timeout: 30000
        });

        if (response.ok) {
            console.log(`[SCHEDULER] Task ${taskName} triggered successfully`);
            return true;
        } else {
            console.error(`[SCHEDULER] Task ${taskName} failed with status ${response.status}`);
            return false;
        }
    } catch (error) {
        console.error(`[SCHEDULER] Error triggering ${taskName}:`, error.message);
        return false;
    }
}

/**
 * Initialize all scheduled tasks
 */
export function initializeScheduler() {
    console.log('[SCHEDULER] Initializing Railway-compatible scheduler...');

    // Define all scheduled tasks
    const tasks = [
        // Morning routine
        { cron: '0 7 * * *', name: 'api-data-refresh', desc: 'API data refresh' },
        { cron: '0 8 * * *', name: 'morning-briefing', desc: 'Morning briefing' },
        { cron: '0 9 * * *', name: 'check-followups', desc: 'Check follow-ups' },
        { cron: '0 9 * * 1-5', name: 'stock-alerts-open', desc: 'Stock alerts (market open)' },

        // Midday routine
        { cron: '0 10 * * *', name: 'inbox-review', desc: 'Inbox review (AM)' },
        { cron: '0 11 * * *', name: 'midmorning-checkin', desc: 'Mid-morning check-in' },
        { cron: '0 12 * * 1-5', name: 'stock-alerts-noon', desc: 'Stock alerts (noon)' },
        { cron: '0 13 * * *', name: 'midday-research', desc: 'Midday research' },

        // Afternoon/Evening
        { cron: '0 15 * * *', name: 'inbox-review', desc: 'Inbox review (PM)' },
        { cron: '0 16 * * *', name: 'afternoon-checkin', desc: 'Afternoon check-in' },
        { cron: '0 16 * * 1-5', name: 'stock-alerts-close', desc: 'Stock alerts (market close)' },
        { cron: '0 18 * * *', name: 'evening-summary', desc: 'Evening summary' },

        // Nightly routine
        { cron: '0 21 * * *', name: 'ralph-review', desc: 'Ralph self-improvement' },
        { cron: '0 22 * * *', name: 'daily-ops-report', desc: 'Daily ops report email' },
        { cron: '0 22 * * 0', name: 'weekly-self-review', desc: 'Weekly self-review' },

        // Maintenance
        { cron: '0 2 * * *', name: 'daily-churn', desc: 'Daily journal processing' },
        { cron: '0 3 * * *', name: 'cleanup', desc: 'Cleanup old files' },

        // Hourly
        { cron: '0 * * * *', name: 'dashboard-sync', desc: 'Dashboard sync' },
    ];

    // Schedule each task
    for (const task of tasks) {
        try {
            // Validate cron expression
            if (!cron.validate(task.cron)) {
                console.error(`[SCHEDULER] Invalid cron expression for ${task.name}: ${task.cron}`);
                continue;
            }

            // Schedule the task
            const job = cron.schedule(task.cron, async () => {
                await triggerTask(task.name);
            }, {
                scheduled: true,
                timezone: process.env.TZ || 'Europe/London'
            });

            scheduledJobs.set(task.name, {
                job,
                cron: task.cron,
                desc: task.desc
            });

            console.log(`[SCHEDULER] Scheduled ${task.name}: ${task.cron} - ${task.desc}`);
        } catch (error) {
            console.error(`[SCHEDULER] Failed to schedule ${task.name}:`, error.message);
        }
    }

    // Keep-alive marker for catch-up mechanism
    cron.schedule('*/5 * * * *', async () => {
        try {
            const fs = await import('fs/promises');
            const path = await import('path');
            const markerFile = path.join(process.env.ALEX_WORKSPACE || '/app/.alex', 'logs', '.last-alive');
            await fs.writeFile(markerFile, new Date().toISOString());
        } catch (error) {
            console.error('[SCHEDULER] Failed to update keep-alive marker:', error.message);
        }
    });

    console.log(`[SCHEDULER] Initialized ${scheduledJobs.size} scheduled tasks`);

    // Return scheduler info for status checks
    return {
        getScheduledTasks: () => {
            const tasks = [];
            for (const [name, info] of scheduledJobs) {
                tasks.push({
                    name,
                    cron: info.cron,
                    desc: info.desc,
                    running: info.job.running || false
                });
            }
            return tasks;
        },

        stopAll: () => {
            for (const [name, info] of scheduledJobs) {
                info.job.stop();
                console.log(`[SCHEDULER] Stopped task: ${name}`);
            }
            scheduledJobs.clear();
        },

        triggerManual: async (taskName) => {
            console.log(`[SCHEDULER] Manual trigger for: ${taskName}`);
            return await triggerTask(taskName);
        }
    };
}

/**
 * Test all task endpoints
 */
export async function testAllTasks() {
    console.log('[SCHEDULER] Testing all task endpoints...');

    const testTasks = [
        'morning-briefing',
        'midday-research',
        'evening-summary',
        'dashboard-sync',
        'ralph-review',
        'daily-ops-report'
    ];

    const results = {};

    for (const taskName of testTasks) {
        const startTime = Date.now();
        const success = await triggerTask(taskName);
        const duration = Date.now() - startTime;

        results[taskName] = {
            success,
            duration,
            timestamp: new Date().toISOString()
        };

        console.log(`[SCHEDULER] Test ${taskName}: ${success ? 'PASS' : 'FAIL'} (${duration}ms)`);

        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return results;
}

// Export for use in gateway.js
export default {
    initializeScheduler,
    testAllTasks
};