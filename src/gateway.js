#!/usr/bin/env node
/**
 * ALEX - Global Economist at NAVADA
 * Main entry point — bot setup, init, message routing
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import TelegramBot from 'node-telegram-bot-api';
import { Redis } from '@upstash/redis';
import os from 'os';
import path from 'path';
import http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Download a file from a URL into a Buffer
function downloadFile(url) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        mod.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadFile(res.headers.location).then(resolve).catch(reject);
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

import { WORKSPACE_PATH, loadConfig } from './config.js';
import { appendFile, mkdir, readFile, writeFile, unlink } from 'fs/promises';
import { createWriteStream } from 'fs';
import https from 'https';
import { MemorySystem } from './memory.js';
import { SkillsSystem } from './skills.js';
import { TOOLS, executeTool, checkRAG, indexRAG, isRAGAvailable, setToolsDashPost } from './tools.js';
import { handleScheduledTask, BUILTIN_TASKS, runDashboardSync, runCleanup, setDashPost, setRedis } from './heartbeat.js';
import { setupInbox, startInboxPolling } from './inbox.js';
import { createChatSystem, getDailyTokenStats, getLifetimeTokenStats, smartSplit } from './chat.js';

// ============================================================================
// GLOBAL STATE
// ============================================================================

let config = {};
let bot = null;
let anthropic = null;
let openaiClient = null;
let deepseekClient = null;
let memory = null;
let skills = null;
let scheduledTasks = new Map();
let redis = null;
const learnModeChats = new Set(); // Track chats with /learn active

// In-memory dashboard state (mirrors dash:data in Redis)
const dashState = {
    title: 'ALEX — NAVADA',
    status: 'offline',
    summary: { total_tasks: 0, completed: 0, in_progress: 0, failed: 0 },
    tasks: [],
    news: [],
    activity_log: [],
    heartbeats: [],
    services: [],
    last_updated: new Date().toISOString(),
};

// Debounce Redis writes — max 1 push per 5 seconds
let dashPushTimer = null;
function scheduleDashPush() {
    if (!redis || dashPushTimer) return;
    dashPushTimer = setTimeout(async () => {
        dashPushTimer = null;
        try {
            dashState.last_updated = new Date().toISOString();
            await redis.set('dash:data', JSON.stringify(dashState));
        } catch (err) {
            console.error('[DASH] Redis push failed:', err.message);
        }
    }, 5000);
}

// Chat system functions (initialized in init())
let chatSystem = null;

// Pending chart images to send after chat() completes
let pendingCharts = [];

// ============================================================================
// TOOL EXECUTION WRAPPER (passes dependencies)
// ============================================================================

async function execToolWithDeps(name, input) {
    const result = await executeTool(name, input, {
        memory,
        skills,
        config,
        scheduledTasks,
        handleScheduledTask: (task) => handleScheduledTask(task, heartbeatDeps()),
        openaiClient,
        bot,
    });
    // Queue files for sending after response completes
    if (result && result.send_photo && result.path) {
        pendingCharts.push({ type: 'photo', path: result.path, caption: result.caption || '' });
    } else if (result && result.send_voice && result.path) {
        pendingCharts.push({ type: 'voice', path: result.path });
    } else if (result && result.send_document && result.path) {
        pendingCharts.push({ type: 'document', path: result.path, caption: result.caption || '' });
    }
    return result;
}

function heartbeatDeps() {
    return {
        callAnthropicQueued: chatSystem.callAnthropicQueued,
        processResponse: chatSystem.processResponse,
        buildSystemPrompt: chatSystem.buildSystemPrompt,
        config,
        get bot() { return bot; },
        TOOLS,
        memory,
    };
}

// ============================================================================
// AUDIT LOG
// ============================================================================

async function auditLog(entry) {
    try {
        const date = new Date().toISOString().split('T')[0];
        const logDir = path.join(WORKSPACE_PATH, 'logs');
        await mkdir(logDir, { recursive: true });
        const logFile = path.join(logDir, `audit_${date}.jsonl`);
        await appendFile(logFile, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n');
    } catch (err) {
        console.error('[AUDIT] Log error:', err.message);
    }
}

function postDashboard(action, payload) {
    const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) + ' GMT';
    switch (action) {
        case 'add_task': {
            const t = payload.task;
            dashState.tasks.unshift(t);
            if (dashState.tasks.length > 50) dashState.tasks.length = 50;
            // Update summary
            const s = dashState.summary;
            s.total_tasks++;
            if (t.status === 'completed') s.completed++;
            else if (t.status === 'in_progress') s.in_progress++;
            else if (t.status === 'failed') s.failed++;
            break;
        }
        case 'add_activity': {
            dashState.activity_log.unshift({ time: now, text: payload.entry });
            if (dashState.activity_log.length > 100) dashState.activity_log.length = 100;
            break;
        }
        case 'add_news': {
            const item = { ...payload.item, time: now };
            dashState.news.unshift(item);
            if (dashState.news.length > 30) dashState.news.length = 30;
            break;
        }
        case 'update_services': {
            dashState.services = payload.services;
            break;
        }
        case 'set_status': {
            dashState.status = payload.status;
            break;
        }
        case 'update_metrics': {
            dashState.metrics = payload.metrics;
            break;
        }
        case 'update_task': {
            const existing = dashState.tasks.find(t => t.name === payload.name);
            if (existing && payload.updates) Object.assign(existing, payload.updates);
            break;
        }
    }
    scheduleDashPush();
}

// ============================================================================
// TELEGRAM BOT SETUP
// ============================================================================

function setupTelegram() {
    bot = new TelegramBot(config.telegram_bot_token, { polling: true });

    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        const welcome = `*ALEX — Global Economist at NAVADA*

I'm ALEX, an autonomous AI economist running 24/7 on a Raspberry Pi. I research markets, write reports, send emails, and manage tasks — all on my own or when you ask.

*What I can do:*
• Research global markets, startups, and economic trends
• Draft and send professional emails with attachments
• Generate PDF reports and data visualisations
• Schedule recurring tasks and reminders
• Remember everything we discuss across sessions
• Create new skills to extend my own capabilities
• Monitor the Gmail inbox and auto-reply to contacts
• Run code, manage files, and control this Pi

*Commands:*
/status — System health, uptime, temperature
/memory — What I currently remember (by category)
/skills — Custom skills I've learned
/tasks — Scheduled and recurring tasks
/tokens — Today's API usage breakdown
/spend — Full lifetime cost and spending report
/learn — Enter educational mode (structured answers)
/exit — Leave educational mode
/clear — Wipe conversation history
/help — Full command list with tips

Just message me naturally — I'm here to help.

[About ALEX](https://alexnavada.xyz) · [NAVADA](https://www.navada.space)`;

        await bot.sendMessage(chatId, welcome, { parse_mode: 'Markdown' });
        await memory.appendMemory('user', `New session started with ${msg.from.first_name} (ID: ${userId})`);
    });

    bot.onText(/\/learn/, async (msg) => {
        const chatId = msg.chat.id;
        if (learnModeChats.has(chatId)) {
            learnModeChats.delete(chatId);
            await bot.sendMessage(chatId, `*Educational mode off.*\n\nI'll respond normally from here.`, { parse_mode: 'Markdown' });
        } else {
            learnModeChats.add(chatId);
            await bot.sendMessage(chatId, `*Educational mode on.*\n\nI'll now structure every answer in three parts:\n\n*What* — The facts and core concept\n*How* — How it works or applies in practice\n*Why* — Why it matters and the deeper reasoning\n\nAsk me anything. Send /exit to leave educational mode.`, { parse_mode: 'Markdown' });
        }
    });

    bot.onText(/\/exit/, async (msg) => {
        const chatId = msg.chat.id;
        if (learnModeChats.has(chatId)) {
            learnModeChats.delete(chatId);
            await bot.sendMessage(chatId, `*Educational mode off.*\n\nBack to normal.`, { parse_mode: 'Markdown' });
        } else {
            await bot.sendMessage(chatId, `No active mode to exit.`);
        }
    });

    bot.onText(/\/status/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const { stdout: uptime } = await execAsync('uptime -p');
            const { stdout: temp } = await execAsync('vcgencmd measure_temp 2>/dev/null || echo "temp=N/A"');
            const { stdout: disk } = await execAsync("df -h / | tail -1 | awk '{print $5}'");
            const { stdout: mem } = await execAsync("free -m | awk '/Mem:/ {printf \"%.1f%%\", $3/$2 * 100}'");
            const { stdout: loadavg } = await execAsync("cat /proc/loadavg | awk '{print $1, $2, $3}'");

            const tasks = Array.from(scheduledTasks.keys());
            const uptimeSec = os.uptime();
            const days = Math.floor(uptimeSec / 86400);
            const hours = Math.floor((uptimeSec % 86400) / 3600);

            const status = `*ALEX — System Status*

*Hardware:*
• Raspberry Pi 5 (${os.arch()})
• Temperature: ${temp.trim().replace('temp=', '')}
• Uptime: ${uptime.trim()} (${days}d ${hours}h)
• Load average: ${loadavg.trim()}

*Resources:*
• Memory: ${mem.trim()} used
• Disk: ${disk.trim()} used
• Node.js: ${process.version}

*Services:*
• Telegram bot: online
• Control API: port 9090
• Gmail inbox: ${config.gmail_address ? 'polling' : 'disabled'}
• Dashboard: ${redis ? 'connected' : 'local only'}

*Scheduled Tasks:* ${tasks.length > 0 ? tasks.map(t => `\`${t}\``).join(', ') : 'None active'}
*Learn Mode:* ${learnModeChats.has(chatId) ? 'on' : 'off'}
*Workspace:* \`${WORKSPACE_PATH}\``;

            await bot.sendMessage(chatId, status, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(chatId, `Error getting status: ${error.message}`);
        }
    });

    bot.onText(/\/memory/, async (msg) => {
        const chatId = msg.chat.id;
        const categories = ['user', 'projects', 'research', 'tasks', 'knowledge'];
        let text = '*ALEX — Memory Banks*\n\n';
        let totalEntries = 0;
        for (const cat of categories) {
            const content = await memory.getMemory(cat);
            const lines = content.split('\n').filter(l => l.trim()).length;
            totalEntries += lines;
            const desc = { user: 'People and preferences', projects: 'Active projects and goals', research: 'Market data and findings', tasks: 'Task history and outcomes', knowledge: 'Accumulated facts and insights' };
            text += `*${cat}* — ${desc[cat]}\n  ${lines} entries\n\n`;
        }
        text += `*Total:* ${totalEntries} entries across ${categories.length} categories\n\n`;
        text += `_I remember everything we discuss. Ask me to save or forget anything._`;
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/skills/, async (msg) => {
        const chatId = msg.chat.id;
        const allSkills = await skills.getAllSkills();
        let text = '*ALEX — Learned Skills*\n\n';
        if (allSkills.length === 0) {
            text += `No custom skills yet.\n\n_Ask me to create a skill for any recurring task — I'll learn it and remember how to do it next time._`;
        } else {
            for (const skill of allSkills) {
                text += `• \`${skill.name}\`\n`;
            }
            text += `\n${allSkills.length} skill${allSkills.length !== 1 ? 's' : ''} available.\n\n_I can create new skills on request. Just describe what you need automated._`;
        }
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/tasks/, async (msg) => {
        const chatId = msg.chat.id;
        const tasks = Array.from(scheduledTasks.entries());

        let text = '*ALEX — Scheduled Tasks*\n\n';
        if (tasks.length === 0) {
            text += `No active scheduled tasks.\n\n_Ask me to schedule anything — briefings, reports, reminders, research runs. I'll set it up with system cron and run it automatically._`;
        } else {
            for (const [name] of tasks) {
                text += `• \`${name}\`\n`;
            }
            text += `\n${tasks.length} task${tasks.length !== 1 ? 's' : ''} scheduled.\n\n_Tasks run automatically via system cron. I can add, remove, or adjust schedules anytime._`;
        }
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/tokens/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const stats = await getDailyTokenStats();
            let text = `*ALEX — Token Usage Today*\n\n`;
            text += `*Total:* ${stats.totalCalls} API calls\n`;
            text += `*Input:* ${stats.totalIn.toLocaleString()} tokens\n`;
            text += `*Output:* ${stats.totalOut.toLocaleString()} tokens\n\n`;
            if (Object.keys(stats.byModel).length > 0) {
                text += `*By Model:*\n`;
                for (const [model, data] of Object.entries(stats.byModel)) {
                    const shortName = model.includes('haiku') ? 'Haiku' : model.includes('sonnet') ? 'Sonnet' : model.includes('deepseek') ? 'DeepSeek' : model;
                    text += `• ${shortName}: ${data.calls} calls — ${data.input.toLocaleString()} in / ${data.output.toLocaleString()} out\n`;
                }
            }
            text += `\n_For full cost breakdown, use /spend_`;
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(chatId, `Error getting token stats: ${error.message}`);
        }
    });

    bot.onText(/\/spend/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const stats = await getLifetimeTokenStats();
            if (!stats.firstDay) {
                await bot.sendMessage(chatId, 'No token usage data found.');
                return;
            }

            const GBP_RATE = 0.79;

            // Format first day nicely
            const firstDate = new Date(stats.firstDay + 'T00:00:00');
            const firstDayFmt = firstDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

            const totalCostUsd = stats.totalCostGbp / GBP_RATE;

            // Balance tracking
            const balanceUsd = config.anthropic_balance_usd || 0;
            const balanceDate = config.anthropic_balance_date || stats.firstDay;

            // Calculate spend since balance was set
            let spentSinceBalanceGbp = 0;
            if (stats.byDay) {
                for (const day of stats.byDay) {
                    if (day.date >= balanceDate) {
                        spentSinceBalanceGbp += day.costGbp;
                    }
                }
            }
            const spentSinceBalanceUsd = spentSinceBalanceGbp / GBP_RATE;
            const remainingUsd = balanceUsd - spentSinceBalanceUsd;
            const remainingGbp = remainingUsd * GBP_RATE;

            // Estimate days remaining at current burn rate
            const avgDailyCostUsd = stats.byDay.length > 0 ? totalCostUsd / stats.byDay.length : 0;
            const daysRemaining = avgDailyCostUsd > 0 ? Math.floor(remainingUsd / avgDailyCostUsd) : 0;

            // Today's cost
            const today = new Date().toISOString().split('T')[0];
            const todayData = stats.byDay.find(d => d.date === today);
            const todayCostGbp = todayData ? todayData.costGbp : 0;

            let text = `*ALEX — Spending Report*\n\n`;

            // Wallet section
            text += `*Anthropic Wallet:*\n`;
            text += `• Loaded: $${balanceUsd.toFixed(2)} (${balanceDate})\n`;
            text += `• Spent since: $${spentSinceBalanceUsd.toFixed(2)} / £${spentSinceBalanceGbp.toFixed(2)}\n`;
            text += `• *Remaining: $${remainingUsd.toFixed(2)} / £${remainingGbp.toFixed(2)}*\n`;
            if (daysRemaining > 0) {
                text += `• Runway: ~${daysRemaining} days at current rate\n`;
            }
            text += `\n`;

            // Today
            text += `*Today's Cost:* £${todayCostGbp.toFixed(4)}\n\n`;

            // Lifetime
            text += `*Lifetime:*\n`;
            text += `• Operational since: ${firstDayFmt} (${stats.totalDays} day${stats.totalDays !== 1 ? 's' : ''})\n`;
            text += `• Total calls: ${stats.totalCalls}\n`;
            text += `• Total cost: £${stats.totalCostGbp.toFixed(4)} / $${totalCostUsd.toFixed(4)}\n\n`;

            // By model (sorted by cost descending)
            const models = Object.entries(stats.byModel).sort((a, b) => b[1].costGbp - a[1].costGbp);
            text += `*By Model:*\n`;
            for (const [name, data] of models) {
                text += `• ${name}: ${data.calls} calls — £${data.costGbp.toFixed(4)}\n`;
            }

            // Daily breakdown (last 7 days, reversed so most recent first)
            text += `\n*Last 7 Days:*\n`;
            const recentDays = stats.byDay.slice(-7).reverse();
            for (const day of recentDays) {
                const d = new Date(day.date + 'T00:00:00');
                const dayFmt = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                const tokFmt = day.tokens >= 1_000_000 ? `${(day.tokens / 1_000_000).toFixed(1)}M` : `${(day.tokens / 1_000).toFixed(1)}K`;
                text += `• ${dayFmt}: ${day.calls} calls, ${tokFmt} tokens — £${day.costGbp.toFixed(4)}\n`;
            }

            // Averages
            const avgTokensPerCall = stats.totalCalls > 0 ? stats.totalTokens / stats.totalCalls : 0;
            const avgTokFmt = avgTokensPerCall >= 1_000_000 ? `${(avgTokensPerCall / 1_000_000).toFixed(1)}M` : `${(avgTokensPerCall / 1_000).toFixed(1)}K`;
            text += `\n*Daily Averages:*\n`;
            text += `• £${stats.avgCostPerDay.toFixed(2)} / day ($${(stats.avgCostPerDay / GBP_RATE).toFixed(2)})\n`;
            text += `• £${stats.avgCostPerCall.toFixed(4)} / call\n`;
            text += `• ${avgTokFmt} tokens / call`;

            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(chatId, `Error getting spending report: ${error.message}`);
        }
    });

    bot.onText(/\/clear/, async (msg) => {
        const chatId = msg.chat.id;
        await memory.saveConversation(chatId, []);
        learnModeChats.delete(chatId);
        await bot.sendMessage(chatId, `*Conversation cleared.*\n\nStarting fresh. My long-term memory (people, projects, research) is still intact — only the chat history was wiped.`, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        const help = `*ALEX — Command Reference*

*Core:*
/start — Introduction and overview
/help — This reference guide

*Intelligence:*
/learn — Enter educational mode (What / How / Why)
/exit — Leave educational mode
/memory — Browse my memory banks
/skills — View custom skills I've learned

*Operations:*
/status — System health, hardware, services
/tasks — Scheduled and recurring tasks
/tokens — Today's API usage by model
/spend — Full lifetime cost report

*Utility:*
/clear — Wipe chat history (keeps long-term memory)

*Tips:*
• Just message naturally — no commands needed for most things
• Ask me to remember facts, preferences, or instructions
• I can draft emails, generate PDFs, create charts, and schedule tasks
• Say "use deepseek" or "use haiku" to switch models for a message
• I monitor Gmail and auto-reply to new contacts
• I run scheduled briefings and research autonomously
• Everything I do is logged to the live dashboard

*About ALEX:*
Built by NAVADA. Running 24/7 on a Raspberry Pi 5.
[alexnavada.xyz](https://alexnavada.xyz) · [navada.space](https://www.navada.space)`;

        await bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
    });

    // Main message handler — with dedup to prevent double-processing
    const processedMessages = new Set();
    bot.on('message', async (msg) => {
        if (msg.text && msg.text.startsWith('/')) return;

        // Dedup: skip if we've already seen this message_id
        if (processedMessages.has(msg.message_id)) return;
        processedMessages.add(msg.message_id);
        // Keep set from growing forever — prune old entries periodically
        if (processedMessages.size > 200) {
            const entries = [...processedMessages];
            entries.slice(0, 100).forEach(id => processedMessages.delete(id));
        }

        const chatId = msg.chat.id;
        const userId = msg.from.id;

        // Check authorization
        if (config.telegram_authorized_users?.length > 0) {
            if (!config.telegram_authorized_users.includes(userId)) {
                await bot.sendMessage(chatId, 'Unauthorized. Your user ID is not in the allowed list.');
                return;
            }
        }

        await bot.sendChatAction(chatId, 'typing');

        try {
            let userMessage = '';
            let contentBlocks = null; // multimodal content for images/docs

            if (msg.text) {
                userMessage = msg.text;
            } else if (msg.photo) {
                // Get highest resolution photo
                const photo = msg.photo[msg.photo.length - 1];
                try {
                    const fileLink = await bot.getFileLink(photo.file_id);
                    const imgBuffer = await downloadFile(fileLink);
                    const base64 = imgBuffer.toString('base64');
                    const caption = msg.caption || 'What is this image? Describe and analyse it.';
                    contentBlocks = [
                        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
                        { type: 'text', text: caption }
                    ];
                    userMessage = caption;
                } catch (dlErr) {
                    console.error('[PHOTO] Download failed:', dlErr.message);
                    userMessage = `[User sent a photo but download failed: ${dlErr.message}]`;
                }
            } else if (msg.document) {
                try {
                    const fileLink = await bot.getFileLink(msg.document.file_id);
                    const fileBuffer = await downloadFile(fileLink);
                    const fileName = msg.document.file_name || 'unknown';
                    const ext = path.extname(fileName).toLowerCase();
                    const caption = msg.caption || `Analyse this file: ${fileName}`;
                    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

                    if (imageExts.includes(ext)) {
                        // Image sent as document
                        const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
                        const base64 = fileBuffer.toString('base64');
                        contentBlocks = [
                            { type: 'image', source: { type: 'base64', media_type: mimeMap[ext] || 'image/jpeg', data: base64 } },
                            { type: 'text', text: caption }
                        ];
                    } else if (ext === '.pdf') {
                        // PDF — send as document to Claude
                        const base64 = fileBuffer.toString('base64');
                        contentBlocks = [
                            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
                            { type: 'text', text: caption }
                        ];
                    } else {
                        // Text-based files — read as text
                        const textContent = fileBuffer.toString('utf-8').substring(0, 50000);
                        contentBlocks = [
                            { type: 'text', text: `[File: ${fileName}]\n\n${textContent}\n\n${caption}` }
                        ];
                    }
                    userMessage = caption;
                } catch (dlErr) {
                    console.error('[DOCUMENT] Download failed:', dlErr.message);
                    userMessage = `[User sent ${msg.document.file_name} but download failed: ${dlErr.message}]`;
                }
            } else if (msg.voice) {
                try {
                    const fileLink = await bot.getFileLink(msg.voice.file_id);
                    const audioBuffer = await downloadFile(fileLink);

                    // Save voice note to disk
                    const voiceDir = path.join(WORKSPACE_PATH, 'voice');
                    await mkdir(voiceDir, { recursive: true });
                    const ts = new Date().toISOString().replace(/[:.]/g, '-');
                    const voiceFilename = `${ts}_${msg.from.first_name || 'unknown'}.ogg`;
                    const voicePath = path.join(voiceDir, voiceFilename);
                    await writeFile(voicePath, audioBuffer);
                    console.log(`[VOICE] Saved to ${voicePath}`);

                    if (openaiClient) {
                        const audioFile = new File([audioBuffer], 'voice.ogg', { type: 'audio/ogg' });
                        const transcription = await openaiClient.audio.transcriptions.create({
                            model: 'whisper-1',
                            file: audioFile,
                        });
                        userMessage = transcription.text || '[Voice message could not be transcribed]';
                        console.log(`[VOICE] Transcribed: ${userMessage.substring(0, 100)}`);

                        // Save transcription alongside the audio
                        await writeFile(voicePath.replace('.ogg', '.txt'), userMessage).catch(() => {});
                    } else {
                        userMessage = '[User sent a voice message but OpenAI is not configured for transcription]';
                    }
                } catch (voiceErr) {
                    console.error('[VOICE] Transcription failed:', voiceErr.message);
                    userMessage = '[User sent a voice message but transcription failed]';
                }
            }

            if (!userMessage && !contentBlocks) return;

            const timestamp = new Date().toISOString();
            console.log(`[INPUT] ${timestamp} | User: ${msg.from.first_name} (${userId}) | Message: ${userMessage.substring(0, 200)}`);
            await auditLog({
                type: 'user_message',
                user_id: userId,
                username: msg.from.username || null,
                first_name: msg.from.first_name,
                last_name: msg.from.last_name || null,
                chat_id: chatId,
                message: userMessage,
            });
            postDashboard('add_activity', { entry: `${msg.from.first_name}: ${userMessage.substring(0, 120)}` });

            // Detect short casual messages (greetings, etc.)
            const isShortCasual = userMessage.length < 80 && /^(hi|hey|hello|yo|sup|morning|evening|good\s|what'?s up|how are you|howdy|hiya)/i.test(userMessage.trim());

            if (isShortCasual) {
                // For greetings: just pause naturally, no ack — avoids double response
                await new Promise(r => setTimeout(r, 3000 + Math.random() * 3000));
            } else {
                // For substantial messages: send acknowledgement then work
                const acks = ['On it.', 'Give me a moment.', 'Looking into it.', 'One sec.', 'Let me check.'];
                const ack = acks[Math.floor(Math.random() * acks.length)];
                await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
                await bot.sendMessage(chatId, ack, { parse_mode: 'Markdown' });
            }

            // Keep typing indicator alive
            const typingInterval = setInterval(() => {
                bot.sendChatAction(chatId, 'typing').catch(() => {});
            }, 4000);

            // Inject learn mode instruction if active
            let chatInput = contentBlocks || userMessage;
            if (learnModeChats.has(chatId)) {
                const learnPrefix = '[LEARN MODE ACTIVE] Structure your entire response in three clear sections:\n\nWhat — State the facts, define the concept or answer the question directly.\nHow — Explain how it works, how it applies, or how to do it in practice.\nWhy — Explain why it matters, the deeper reasoning, or the significance.\n\nKeep each section concise but thorough. Now answer this:\n\n';
                if (typeof chatInput === 'string') {
                    chatInput = learnPrefix + chatInput;
                } else if (Array.isArray(chatInput)) {
                    chatInput = [{ type: 'text', text: learnPrefix }, ...chatInput];
                }
            }

            let response;
            try {
                response = await chatSystem.chat(chatId, chatInput, msg.from);
            } finally {
                clearInterval(typingInterval);
            }

            await auditLog({
                type: 'alex_response',
                user_id: userId,
                chat_id: chatId,
                response: response.substring(0, 5000),
                response_length: response.length,
            });
            postDashboard('add_activity', { entry: `Alex responded to ${msg.from.first_name} (${response.length} chars)` });

            // Log task to dashboard
            const taskSummary = userMessage.substring(0, 80);
            postDashboard('add_task', { task: {
                name: taskSummary,
                category: 'user-request',
                status: 'completed',
                time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) + ' GMT',
            }});

            // Send any queued files (photos + documents)
            const files = pendingCharts.splice(0);
            for (const file of files) {
                try {
                    if (file.type === 'voice') {
                        await bot.sendVoice(chatId, file.path);
                        unlink(file.path).catch(() => {});
                    } else if (file.type === 'document') {
                        await bot.sendDocument(chatId, file.path, {
                            caption: file.caption || undefined,
                        });
                    } else {
                        await bot.sendPhoto(chatId, file.path, {
                            caption: file.caption || undefined,
                        });
                    }
                } catch (fileErr) {
                    console.error('[FILE] Failed to send:', fileErr.message);
                }
            }

            // Smart message splitting at paragraph boundaries
            const parts = smartSplit(response, 4000);
            for (const part of parts) {
                await bot.sendMessage(chatId, part, { parse_mode: 'Markdown' });
            }

        } catch (error) {
            console.error('[ERROR]', error);
            const isRateLimit = error?.status === 429 || (error.message && error.message.toLowerCase().includes('rate limit'));
            const isOverloaded = error?.status === 529 || (error.message && error.message.toLowerCase().includes('overloaded'));
            if (isRateLimit || isOverloaded) {
                console.log('[RATE_LIMIT] Retries exhausted, notifying user');
                await bot.sendMessage(chatId, 'I\'m experiencing high demand right now. I\'ll retry your request shortly — hang tight.');
                setTimeout(async () => {
                    try {
                        await bot.sendChatAction(chatId, 'typing');
                        const retryResponse = await chatSystem.chat(chatId, msg.text || '', msg.from);
                        await bot.sendMessage(chatId, retryResponse, { parse_mode: 'Markdown' });
                    } catch (retryErr) {
                        console.error('[RETRY_FAILED]', retryErr.message);
                    }
                }, 60000);
            } else {
                await bot.sendMessage(chatId, `Something went wrong, but I've logged the issue. Try again in a moment.`);
            }
        }
    });

    console.log('[TELEGRAM] Bot started and listening...');
}

// ============================================================================
// CONTROL API (port 9090) — allows Claude Code to send commands to ALEX
// ============================================================================

function setupControlAPI() {
    const CONTROL_PORT = 9090;
    const controlChatId = 'control-api';

    const server = http.createServer(async (req, res) => {
        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

        if (req.method === 'POST' && req.url === '/api/command') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const { message, image_path, send_to_telegram } = JSON.parse(body);
                    if (!message) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: 'message required' }));
                        return;
                    }

                    console.log(`[CONTROL] Command: ${message.substring(0, 100)}`);
                    postDashboard('add_activity', { entry: `Control API: ${message.substring(0, 80)}` });

                    // Build user message — include image reference if provided
                    let userMessage = message;
                    if (image_path) {
                        userMessage += `\n\n[Image attached at: ${image_path}]`;
                    }

                    // Process through chat system
                    const response = await chatSystem.chat(controlChatId, userMessage, { first_name: 'Claude Code', username: 'claude_code' });

                    // Send queued files
                    const files = pendingCharts.splice(0);

                    // Optionally forward response + files to Telegram
                    if (send_to_telegram !== false && config.telegram_owner_id) {
                        const { smartSplit } = await import('./chat.js');
                        const parts = smartSplit(response, 4000);
                        for (const part of parts) {
                            await bot.sendMessage(config.telegram_owner_id, part, { parse_mode: 'Markdown' }).catch(() => {});
                        }
                        for (const file of files) {
                            try {
                                if (file.type === 'voice') {
                                    await bot.sendVoice(config.telegram_owner_id, file.path);
                                    unlink(file.path).catch(() => {});
                                } else if (file.type === 'document') {
                                    await bot.sendDocument(config.telegram_owner_id, file.path, { caption: file.caption || undefined });
                                } else {
                                    await bot.sendPhoto(config.telegram_owner_id, file.path, { caption: file.caption || undefined });
                                }
                            } catch {}
                        }
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, response, files_sent: files.length }));

                } catch (err) {
                    console.error('[CONTROL] Error:', err.message);
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
        } else if (req.method === 'POST' && req.url === '/api/send') {
            // Send a direct message to a specific Telegram user
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const { chat_id, message, image_path, document_path, parse_mode } = JSON.parse(body);
                    if (!chat_id || (!message && !image_path && !document_path)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: 'chat_id and (message or image_path or document_path) required' }));
                        return;
                    }

                    console.log(`[CONTROL] Send to ${chat_id}: ${(message || '').substring(0, 80)}`);
                    const results = [];

                    if (message) {
                        await bot.sendMessage(chat_id, message, { parse_mode: parse_mode || undefined });
                        results.push('message_sent');
                    }
                    if (image_path) {
                        await bot.sendPhoto(chat_id, image_path, { caption: message ? undefined : 'Image from ALEX' });
                        results.push('photo_sent');
                    }
                    if (document_path) {
                        await bot.sendDocument(chat_id, document_path, { caption: message ? undefined : 'File from ALEX' });
                        results.push('document_sent');
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, results }));
                } catch (err) {
                    console.error('[CONTROL] Send error:', err.message);
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: err.message }));
                }
            });

        } else if (req.method === 'GET' && req.url === '/api/users') {
            // List known Telegram users from audit logs
            try {
                const logsDir = path.join(WORKSPACE_PATH, 'logs');
                const files = await import('fs/promises').then(f => f.default?.readdir?.(logsDir) || f.readdir(logsDir));
                const users = new Map();

                for (const file of files) {
                    if (!file.startsWith('audit_')) continue;
                    const content = await import('fs/promises').then(f => f.readFile(path.join(logsDir, file), 'utf-8'));
                    for (const line of content.split('\n')) {
                        if (!line.trim()) continue;
                        try {
                            const entry = JSON.parse(line);
                            if (entry.user_id && entry.type === 'user_message') {
                                users.set(entry.user_id, {
                                    user_id: entry.user_id,
                                    username: entry.username || null,
                                    first_name: entry.first_name || null,
                                    last_name: entry.last_name || null,
                                    chat_id: entry.chat_id,
                                    last_seen: entry.timestamp,
                                });
                            }
                        } catch {}
                    }
                }

                const userList = [...users.values()].sort((a, b) => (b.last_seen || '').localeCompare(a.last_seen || ''));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, users: userList, count: userList.length }));
            } catch (err) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: err.message }));
            }

        } else if (req.method === 'POST' && req.url === '/api/broadcast') {
            // Send a message to ALL known users
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const { message, image_path } = JSON.parse(body);
                    if (!message && !image_path) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: 'message or image_path required' }));
                        return;
                    }

                    // Get all known chat IDs from audit logs
                    const logsDir = path.join(WORKSPACE_PATH, 'logs');
                    const files = await import('fs/promises').then(f => f.default?.readdir?.(logsDir) || f.readdir(logsDir));
                    const chatIds = new Set();
                    for (const file of files) {
                        if (!file.startsWith('audit_')) continue;
                        const content = await import('fs/promises').then(f => f.readFile(path.join(logsDir, file), 'utf-8'));
                        for (const line of content.split('\n')) {
                            if (!line.trim()) continue;
                            try {
                                const entry = JSON.parse(line);
                                if (entry.chat_id) chatIds.add(entry.chat_id);
                            } catch {}
                        }
                    }

                    let sent = 0;
                    for (const cid of chatIds) {
                        try {
                            if (message) await bot.sendMessage(cid, message);
                            if (image_path) await bot.sendPhoto(cid, image_path);
                            sent++;
                        } catch {}
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, sent, total_users: chatIds.size }));
                } catch (err) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: err.message }));
                }
            });

        } else if (req.method === 'POST' && req.url === '/api/trigger') {
            // Trigger a scheduled task by name (called by system cron)
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const { task: taskName } = JSON.parse(body);
                    if (!taskName) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: 'task name required' }));
                        return;
                    }

                    console.log(`[TRIGGER] ${taskName}`);

                    // Special cases (non-AI)
                    if (taskName === 'dashboard-sync') {
                        await runDashboardSync();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, task: taskName }));
                        return;
                    }
                    if (taskName === 'cleanup') {
                        await runCleanup(memory);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, task: taskName }));
                        return;
                    }

                    // Look up task definition: built-in first, then user tasks on disk
                    let taskDef = BUILTIN_TASKS.get(taskName);
                    if (!taskDef) {
                        try {
                            const taskFile = path.join(WORKSPACE_PATH, 'tasks', `${taskName}.json`);
                            taskDef = JSON.parse(await import('fs/promises').then(f => f.readFile(taskFile, 'utf-8')));
                        } catch {
                            res.writeHead(404);
                            res.end(JSON.stringify({ error: `Unknown task: ${taskName}` }));
                            return;
                        }
                    }

                    // Run asynchronously so we can respond immediately
                    handleScheduledTask(taskDef, heartbeatDeps()).catch(err => {
                        console.error(`[TRIGGER] ${taskName} failed:`, err.message);
                    });

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, task: taskName }));
                } catch (err) {
                    console.error('[TRIGGER] Error:', err.message);
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: err.message }));
                }
            });

        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Endpoints: POST /api/command, POST /api/send, GET /api/users, POST /api/broadcast, POST /api/trigger' }));
        }
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`[CONTROL] Port ${CONTROL_PORT} already in use — skipping control API`);
        } else {
            console.error(`[CONTROL] Server error:`, err.message);
        }
    });

    server.listen(CONTROL_PORT, '127.0.0.1', () => {
        console.log(`[CONTROL] API listening on http://127.0.0.1:${CONTROL_PORT}`);
    });
}

// ============================================================================
// MISSED TASK CATCH-UP — fires tasks that were missed during downtime
// ============================================================================

async function catchUpMissedTasks() {
    try {
        const markerFile = path.join(WORKSPACE_PATH, 'logs', '.last-alive');
        let lastAlive = null;
        try {
            const raw = await readFile(markerFile, 'utf-8');
            lastAlive = new Date(raw.trim());
        } catch {
            // No marker — first run or marker deleted, skip catch-up
        }

        // Update marker to now
        const logDir = path.join(WORKSPACE_PATH, 'logs');
        await mkdir(logDir, { recursive: true });
        await writeFile(markerFile, new Date().toISOString());

        if (!lastAlive || isNaN(lastAlive.getTime())) {
            console.log('[CATCHUP] No previous marker — skipping catch-up');
            return;
        }

        const now = new Date();
        const downMinutes = (now - lastAlive) / 60000;
        if (downMinutes < 3) {
            console.log('[CATCHUP] Downtime < 3 min — no catch-up needed');
            return;
        }

        console.log(`[CATCHUP] ALEX was down for ~${Math.round(downMinutes)} min. Checking for missed tasks...`);

        // Built-in task schedule (hour, days: 0=Sun..6=Sat, '*'=all)
        const schedule = [
            { task: 'morning-briefing',   hour: 8,  days: '*' },
            { task: 'midmorning-checkin',  hour: 11, days: '*' },
            { task: 'midday-research',     hour: 13, days: '*' },
            { task: 'afternoon-checkin',   hour: 16, days: '*' },
            { task: 'evening-summary',     hour: 18, days: '*' },
            { task: 'weekly-self-review',  hour: 22, days: [0] },
        ];

        const missed = [];
        for (const s of schedule) {
            // Check if the scheduled hour falls between lastAlive and now
            const scheduledToday = new Date(now);
            scheduledToday.setHours(s.hour, 0, 0, 0);

            if (scheduledToday > lastAlive && scheduledToday <= now) {
                const dayOk = s.days === '*' || s.days.includes(now.getDay());
                if (dayOk) missed.push(s.task);
            }
        }

        if (missed.length === 0) {
            console.log('[CATCHUP] No tasks missed during downtime');
            return;
        }

        console.log(`[CATCHUP] Firing ${missed.length} missed task(s): ${missed.join(', ')}`);
        for (const taskName of missed) {
            const taskDef = BUILTIN_TASKS.get(taskName);
            if (taskDef) {
                handleScheduledTask(taskDef, heartbeatDeps()).catch(err => {
                    console.error(`[CATCHUP] ${taskName} failed:`, err.message);
                });
                // Stagger by 5s to avoid flooding the API
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    } catch (err) {
        console.error('[CATCHUP] Error:', err.message);
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║     ALEX - Global Economist            ║');
    console.log('║     NAVADA | Starting up...             ║');
    console.log('╚════════════════════════════════════════╝');

    // Load configuration (with schema validation)
    config = await loadConfig();

    // Initialize API clients
    anthropic = new Anthropic({ apiKey: config.anthropic_api_key });

    if (config.openai_api_key) {
        openaiClient = new OpenAI({ apiKey: config.openai_api_key });
        console.log('[OPENAI] Client initialized');
    } else {
        console.log('[OPENAI] No API key configured, image generation and fallback disabled');
    }

    if (config.deepseek_api_key) {
        deepseekClient = new OpenAI({ apiKey: config.deepseek_api_key, baseURL: 'https://api.deepseek.com' });
        console.log('[DEEPSEEK] Client initialized');
    } else {
        console.log('[DEEPSEEK] No API key configured, deep research disabled');
    }

    // Initialize Upstash Redis for dashboard
    if (config.upstash_redis_url && config.upstash_redis_token) {
        redis = new Redis({ url: config.upstash_redis_url, token: config.upstash_redis_token });
        console.log('[REDIS] Upstash client initialized');
    } else {
        console.log('[REDIS] No Upstash config — dashboard pushes disabled');
    }

    // Wire up dashboard helpers for heartbeat + tools modules
    setDashPost(postDashboard);
    setRedis(redis);
    setToolsDashPost(postDashboard);

    // Initialize memory system
    memory = new MemorySystem(WORKSPACE_PATH);
    await memory.init();
    console.log('[MEMORY] Initialized');

    // Initialize skills system
    skills = new SkillsSystem(WORKSPACE_PATH);
    await skills.init();
    console.log('[SKILLS] Initialized');

    // Check and initialize RAG
    await checkRAG();
    if (isRAGAvailable()) {
        await indexRAG();
    }

    // Create chat system with all dependencies
    chatSystem = createChatSystem({
        anthropic,
        openaiClient,
        deepseekClient,
        memory,
        skills,
        executeTool: execToolWithDeps,
        TOOLS,
    });

    // Setup Telegram
    setupTelegram();

    // Setup Control API on port 9090
    setupControlAPI();

    // Start Gmail inbox polling
    setupInbox({ config, bot, postDashboard, anthropic, openaiClient });
    startInboxPolling();

    // Check for missed scheduled tasks during downtime
    await catchUpMissedTasks();

    // Notify dashboard that ALEX is online
    postDashboard('set_status', { status: 'online' });
    postDashboard('add_activity', { entry: 'ALEX started and online' });
    postDashboard('update_services', { services: [
        { name: 'ALEX Gateway', port: 'systemd', status: 'online' },
        { name: 'Upstash Redis', port: 'cloud', status: 'online' },
        { name: 'Telegram Bot', port: 'polling', status: 'online' },
        { name: 'Gmail Inbox', port: 'IMAP', status: config.gmail_address ? 'online' : 'disabled' },
    ]});

    // Write alive marker every 60s so catch-up knows when we were last running
    setInterval(async () => {
        try {
            await writeFile(path.join(WORKSPACE_PATH, 'logs', '.last-alive'), new Date().toISOString());
        } catch {}
    }, 60000);

    console.log('');
    console.log('ALEX is now online and ready!');
    console.log(`Workspace: ${WORKSPACE_PATH}`);
    console.log('');
}

init().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
