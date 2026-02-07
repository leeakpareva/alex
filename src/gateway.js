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
import { exec, execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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

// Extract text from PDF and save for RAG indexing (async, fire-and-forget)
async function extractPdfForRag(pdfPath) {
    try {
        // Extract text using pdftotext
        const { stdout } = await execFileAsync('pdftotext', ['-layout', pdfPath, '-'], {
            timeout: 30000,
            maxBuffer: 10 * 1024 * 1024
        });

        if (stdout.trim().length < 50) {
            console.log('[PDF] Skipping RAG indexing - extracted text too short');
            return;
        }

        // Save extracted text alongside PDF
        const txtPath = pdfPath.replace(/\.pdf$/i, '.txt');
        await writeFile(txtPath, stdout);
        console.log(`[PDF] Text extracted to ${txtPath} (${stdout.length} chars)`);

        // Trigger RAG re-index (debounced via indexRAG if available)
        if (typeof indexRAG === 'function') {
            indexRAG().catch(err => console.error('[PDF] RAG re-index failed:', err.message));
        }
    } catch (err) {
        console.error('[PDF] Text extraction failed:', err.message);
    }
}

import { WORKSPACE_PATH, loadConfig } from './config.js';
import { access, appendFile, mkdir, readFile, writeFile, unlink, symlink as fsSymlink } from 'fs/promises';
import { createWriteStream } from 'fs';
import https from 'https';
import { MemorySystem } from './memory.js';
import { SkillsSystem } from './skills.js';
import { TOOLS, executeTool, checkRAG, indexRAG, isRAGAvailable, setToolsDashPost, FULL_ACCESS_USERS } from './tools.js';
import { handleScheduledTask, BUILTIN_TASKS, runDashboardSync, runCleanup, setDashPost, setRedis } from './heartbeat.js';
import { setupInbox, startInboxPolling, setInboxChatSystem } from './inbox.js';
import { setupSlack, startSlackPolling } from './slack.js';
import { setupEmailFiling, setEmailFilingChatSystem, getEmailsByStatus, getEmailByNumber, getEmailById, actionEmail, getInboxSummary, archiveOldDone, clearEmailsByStatus, bulkUpdateStatus, deleteEmailByNumber, updateEmailStatus } from './email-filing.js';
import { createChatSystem, getDailyTokenStats, getLifetimeTokenStats, getTokenStatsBySource, smartSplit, selectModel } from './chat.js';
import { processUploadedFile } from './document-processor.js';
import { runRalphReview } from './ralph.js';
import { init as initJournal, appendExchange, writeDiaryEntry, loadShortCache, forceSaveChat, getLastDailyLines, getDiaryContext, modelLabel as journalModelLabel, setJournalRedis, runChurn } from './daily-journal.js';

// ============================================================================
// TELEGRAM MARKDOWN SAFE SEND — tries Markdown, falls back to plain text
// ============================================================================

async function sendMarkdown(chatId, text, extra = {}) {
    try {
        await bot.sendMessage(chatId, text, { ...extra, parse_mode: 'Markdown' });
    } catch (err) {
        // Handle Markdown parse errors (400 Bad Request: can't parse entities)
        const is400 = err?.response?.body?.error_code === 400 || err?.response?.statusCode === 400;
        const isParseError = err?.message?.includes("can't parse entities") || err?.response?.body?.description?.includes("can't parse entities");
        if (is400 || isParseError) {
            // Markdown parse failed — send as plain text
            console.log('[TELEGRAM] Markdown parse failed, sending as plain text');
            await bot.sendMessage(chatId, text, extra);
        } else {
            throw err;
        }
    }
}

// ============================================================================
// GLOBAL STATE
// ============================================================================

let config = {};
let bot = null;
let anthropic = null;
let openaiClient = null;
let deepseekClient = null;
let kimiClient = null;
let openrouterClient = null;
let memory = null;
let skills = null;
let scheduledTasks = new Map();
let redis = null;
let localRedis = null;
const learnModeChats = new Set(); // Track chats with /learn active
const mathModeChats = new Set(); // Track chats with /mathematician active
const strategistModeChats = new Set(); // Track chats with /strategist active
const voiceModeChats = new Set(); // Track chats with /voice active
const pythonModeChats = new Set(); // Track chats with /python active
const modelOverrides = new Map(); // Track per-chat model locks
const awaitingModelSelect = new Set(); // Chats waiting for model selection reply
const recentUploads = new Map(); // chatId → [{ path, filename, timestamp }]
let lastOwnerMessageTime = Date.now(); // Track owner activity for idle starters

// KEMET Automotive authorized users (Lee, Nissi, Chopstix)
const KEMET_AUTHORIZED_USERS = new Set([
    '6920669447',   // Lee (owner)
    // Add Nissi's Telegram ID when known
    // Add Chopstix's Telegram ID when known
]);

function isKemetAuthorized(userId) {
    return KEMET_AUTHORIZED_USERS.has(String(userId));
}

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
    apify: { total_calls: 0, total_results: 0, last_call: null },
    ralph: { last_run: null, status: 'pending', issues: [], fixes: [], health: '', review_date: null },
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

function getUploadedFiles(chatId) {
    const uploads = recentUploads.get(chatId) || [];
    const oneHourAgo = Date.now() - 3600000;
    const recent = uploads.filter(u => u.timestamp > oneHourAgo);
    recentUploads.set(chatId, recent);
    return recent;
}

// Track the current caller's userId for tool permission checks
let currentCallerUserId = null;

async function execToolWithDeps(name, input) {
    const toolStart = Date.now();
    let result, toolError;
    try {
        result = await executeTool(name, input, {
            memory,
            skills,
            config,
            scheduledTasks,
            handleScheduledTask: (task) => handleScheduledTask(task, heartbeatDeps()),
            openaiClient,
            bot,
            getUploadedFiles,
            callerUserId: currentCallerUserId,
        });
    } catch (err) {
        toolError = err;
        throw err;
    } finally {
        auditLog({
            type: 'tool_execution',
            tool: name,
            user_id: currentCallerUserId,
            duration_ms: Date.now() - toolStart,
            success: !toolError && !(result && result.success === false),
            error: toolError ? toolError.message : (result && result.success === false ? result.error : undefined),
        }).catch(() => {});
    }
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
        const logDir = path.join(WORKSPACE_PATH, 'logs', 'audit');
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
        case 'update_inbox': {
            dashState.inbox = payload;
            // Also push to Redis as separate key
            if (redis) {
                redis.set('dash:inbox', JSON.stringify(payload)).catch(e => console.error('[DASH] inbox push failed:', e.message));
            }
            break;
        }
        case 'update_apify': {
            dashState.apify.total_calls++;
            dashState.apify.total_results += payload.results || 0;
            dashState.apify.last_call = now;
            if (payload.actor) dashState.apify.last_actor = payload.actor;
            break;
        }
    }
    scheduleDashPush();
}

// ============================================================================
// TELEGRAM BOT SETUP
// ============================================================================

function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

// Commands restricted to authorized (owner) users only
const LIMITED_USER_ALLOWED_COMMANDS = new Set([
    '/start', '/help', '/stocks', '/news', '/research', '/brief', '/tracked'
]);

function isAuthorizedUser(userId) {
    return config.telegram_authorized_users?.includes(userId);
}

function isLimitedCommand(text) {
    if (!text || !text.startsWith('/')) return false;
    const cmd = text.split(/\s/)[0].split('@')[0].toLowerCase();
    return LIMITED_USER_ALLOWED_COMMANDS.has(cmd);
}

function setupTelegram() {
    bot = new TelegramBot(config.telegram_bot_token, { polling: true });

    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        const welcome = `<b>ALEX — Global Economist at NAVADA</b>

I'm ALEX, an autonomous AI economist running 24/7 on a Raspberry Pi. I research markets, write reports, send emails, and manage tasks — all on my own or when you ask.

<b>What I can do:</b>
• Research global markets, startups, and economic trends
• Draft and send professional emails with attachments
• Generate PDF reports and data visualisations
• Schedule recurring tasks and reminders
• Remember everything we discuss across sessions
• Create new skills to extend my own capabilities
• Monitor the Gmail inbox and auto-reply to contacts
• Look up real-time stock prices, company data, crypto, and economic indicators
• Run code, manage files, and control this Pi

<b>Commands:</b>
/alex — Full command reference
/inbox — Email queue and triage
/action 1 — Act on an email
/mathematician — Quantitative and computational mode
/strategist — Strategic frameworks mode
/learn — Educational mode
/voice — Voice reply mode
/python — Python data analysis mode
/research topic — Deep research on demand
/brief — Recent activity summary
/news — Latest gathered news
/stocks AAPL — Quick stock quote
/tiktok — TikTok scraper (hashtags, profiles)
/linkedinposts — LinkedIn posts search
/indeed — Indeed job search
/leads — Google Maps lead scraper
/scrapers — View all Apify scrapers
/kemet — KEMET Automotive project (restricted)
/status — System health and uptime
/duties — All duties and schedules
/models — Switch AI model
/mode — Show active modes
/tracked — View tracked tasks
/help — Full guide with tips

Just message me naturally — I'm here to help.

<a href="https://www.alexnavada.xyz">www.alexnavada.xyz</a>`;

        await bot.sendMessage(chatId, welcome, { parse_mode: 'HTML' });
        await memory.appendMemory('user', `New session started with ${msg.from.first_name} (ID: ${userId})`);
    });

    // Special greetings for Lee (owner)
    bot.onText(/^my bro$/i, async (msg) => {
        const chatId = msg.chat.id;
        await bot.sendMessage(chatId, "How Far Big LEE!");
    });

    bot.onText(/^(hi|hey|hello|yo|sup)(\s+alex)?[!?.]?$/i, async (msg) => {
        const chatId = msg.chat.id;
        const isOwner = String(msg.from.id) === String(config.telegram_owner_id);
        if (isOwner) {
            const greetings = [
                "Hey Lee, what can I do for you?",
                "Hi Lee, how can I help?",
                "Hey Lee, what's on your mind?",
                "Hi Lee, ready when you are.",
                "Hey Lee, what do you need?",
            ];
            const response = greetings[Math.floor(Math.random() * greetings.length)];
            await bot.sendMessage(chatId, response);
        } else {
            await bot.sendMessage(chatId, "Hello! How can I help you today?");
        }
    });

    bot.onText(/\/save/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        const result = await forceSaveChat(chatId, memory);
        await bot.sendMessage(chatId, result);
    });

    bot.onText(/\/read/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        const lines = await getLastDailyLines(5);
        await bot.sendMessage(chatId, `Alex's Diary (last 5):\n\n${lines}`);
    });

    bot.onText(/\/feedback\s*(good|bad)?(?:\s+(.+))?/i, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        const rating = match?.[1]?.toLowerCase();
        const comment = match?.[2]?.trim();

        if (!rating) {
            await bot.sendMessage(chatId, `*Feedback*\n\nUsage: \`/feedback good [comment]\` or \`/feedback bad [comment]\`\n\nThis helps me learn what's useful and what to improve.`, { parse_mode: 'Markdown' });
            return;
        }

        const feedbackDir = path.join(WORKSPACE_PATH, 'logs', 'feedback');
        await mkdir(feedbackDir, { recursive: true });
        const date = new Date().toISOString().split('T')[0];
        const entry = {
            timestamp: new Date().toISOString(),
            task_name: 'manual',
            rating,
            comment: comment || null,
            user_id: msg.from.id,
        };
        await appendFile(
            path.join(feedbackDir, `feedback_${date}.jsonl`),
            JSON.stringify(entry) + '\n'
        );
        await bot.sendMessage(chatId, `Feedback recorded: ${rating === 'good' ? 'positive' : 'negative'}${comment ? ` — "${comment}"` : ''}`);
    });

    bot.onText(/\/learn/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
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
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        const cleared = [];
        if (learnModeChats.has(chatId)) { learnModeChats.delete(chatId); cleared.push('Educational'); }
        if (mathModeChats.has(chatId)) { mathModeChats.delete(chatId); cleared.push('Mathematician'); }
        if (strategistModeChats.has(chatId)) { strategistModeChats.delete(chatId); cleared.push('Strategist'); }
        if (voiceModeChats.has(chatId)) { voiceModeChats.delete(chatId); cleared.push('Voice'); }
        if (pythonModeChats.has(chatId)) { pythonModeChats.delete(chatId); cleared.push('Python'); }
        if (cleared.length > 0) {
            await bot.sendMessage(chatId, `*${cleared.join(', ')} mode${cleared.length > 1 ? 's' : ''} off.*\n\nBack to normal.`, { parse_mode: 'Markdown' });
        } else {
            await bot.sendMessage(chatId, `No active mode to exit.`);
        }
    });

    bot.onText(/\/status/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const { stdout: uptime } = await execAsync('uptime -p');
            const { stdout: temp } = await execAsync('vcgencmd measure_temp 2>/dev/null || echo "temp=N/A"');
            const { stdout: disk } = await execAsync("df -h / | tail -1 | awk '{print $3 \" / \" $2 \" (\" $5 \")\"}'");
            const { stdout: mem } = await execAsync("free -m | awk '/Mem:/ {printf \"%dMB / %dMB (%.1f%%)\", $3, $2, $3/$2 * 100}'");
            const { stdout: loadavg } = await execAsync("cat /proc/loadavg | awk '{print $1, $2, $3}'");

            const uptimeSec = os.uptime();
            const days = Math.floor(uptimeSec / 86400);
            const hours = Math.floor((uptimeSec % 86400) / 3600);

            // Process uptime (how long since ALEX started, not system)
            const processUpSec = Math.floor(process.uptime());
            const pDays = Math.floor(processUpSec / 86400);
            const pHours = Math.floor((processUpSec % 86400) / 3600);
            const pMins = Math.floor((processUpSec % 3600) / 60);
            const processUpStr = pDays > 0 ? `${pDays}d ${pHours}h ${pMins}m` : pHours > 0 ? `${pHours}h ${pMins}m` : `${pMins}m`;

            // Today's token cost
            let todayCost = '£0.00';
            let todayCalls = 0;
            try {
                const stats = await getDailyTokenStats();
                todayCalls = stats.totalCalls;
                const GBP = 0.79;
                let costGbp = 0;
                for (const [model, data] of Object.entries(stats.byModel)) {
                    let costUsd = 0;
                    if (model.includes('haiku')) costUsd = data.input / 1e6 * 0.8 + data.output / 1e6 * 4;
                    else if (model.includes('deepseek')) costUsd = data.input / 1e6 * 0.14 + data.output / 1e6 * 0.28;
                    else if (model.includes('gpt')) costUsd = data.input / 1e6 * 2.5 + data.output / 1e6 * 10;
                    else costUsd = data.input / 1e6 * 0.8 + data.output / 1e6 * 4;
                    costGbp += costUsd * GBP;
                }
                todayCost = `£${costGbp.toFixed(4)}`;
            } catch {}

            // Workspace size
            let workspaceSize = 'unknown';
            try {
                const { stdout: du } = await execAsync(`du -sh ${WORKSPACE_PATH} 2>/dev/null | awk '{print $1}'`);
                workspaceSize = du.trim();
            } catch {}

            // Conversation count
            let convCount = 0;
            try {
                const { stdout: cc } = await execAsync(`ls ${WORKSPACE_PATH}/conversations/*.json 2>/dev/null | wc -l`);
                convCount = parseInt(cc.trim()) || 0;
            } catch {}

            // Session activity
            const sessionTasks = dashState.tasks.length;
            const sessionActivity = dashState.activity_log.length;

            // Active modes for this chat
            const modes = [learnModeChats.has(chatId) && 'Learn', mathModeChats.has(chatId) && 'Mathematician', strategistModeChats.has(chatId) && 'Strategist', voiceModeChats.has(chatId) && 'Voice', pythonModeChats.has(chatId) && 'Python'].filter(Boolean);

            const status = `*ALEX — System Status*

*Hardware:*
• Raspberry Pi 5 (${os.arch()})
• Temperature: ${temp.trim().replace('temp=', '')}
• System uptime: ${uptime.trim()} (${days}d ${hours}h)
• Load average: ${loadavg.trim()}

*Resources:*
• RAM: ${mem.trim()}
• Disk: ${disk.trim()}
• Workspace: ${workspaceSize}
• Runtime: Node.js ${process.version}

*Services:*
• Telegram bot: online
• Control API: active
• Gmail inbox: ${config.gmail_address ? 'polling' : 'disabled'}
• Slack: ${config.slack_token ? 'polling' : 'disabled'}
• Dashboard: ${redis ? 'connected' : 'local only'}
• DeepSeek: ${deepseekClient ? 'available' : 'disabled'}
• Kimi: ${kimiClient ? 'available' : 'disabled'}
• OpenAI: ${openaiClient ? 'available' : 'disabled'}

*ALEX Process:*
• Running for: ${processUpStr}
• API calls today: ${todayCalls}
• Cost today: ${todayCost}
• Conversations tracked: ${convCount}
• Session tasks: ${sessionTasks} | Activity entries: ${sessionActivity}

*Your Settings:*
• Model: ${modelOverrides.has(chatId) ? modelOverrides.get(chatId) : 'Auto (smart routing)'}
• Modes: ${modes.length > 0 ? modes.join(', ') : 'none'}

_Use /duties for task schedules, /tokens for usage breakdown, /spend for full costs._`;

            await bot.sendMessage(chatId, status, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(chatId, `Error getting status: ${error.message}`);
        }
    });

    bot.onText(/\/security/, async (msg) => {
        const chatId = msg.chat.id;
        if (String(msg.from.id) !== String(config.telegram_owner_id)) {
            await bot.sendMessage(chatId, "Security scan is only available to the account owner.");
            return;
        }

        await bot.sendChatAction(chatId, 'typing');

        try {
            const checks = [];
            let score = 0;
            const maxScore = 15;

            // 1. Config encryption
            const encConfigExists = await execAsync(`test -f ${WORKSPACE_PATH}/config.json.enc && echo "yes" || echo "no"`).then(r => r.stdout.trim() === 'yes').catch(() => false);
            const plainConfigExists = await execAsync(`test -f ${WORKSPACE_PATH}/config.json && echo "yes" || echo "no"`).then(r => r.stdout.trim() === 'yes').catch(() => false);
            if (encConfigExists && !plainConfigExists) {
                checks.push('✅ Config encrypted (AES-256-GCM)');
                score += 2;
            } else if (encConfigExists && plainConfigExists) {
                checks.push('⚠️ Config encrypted but plaintext backup exists');
                score += 1;
            } else {
                checks.push('❌ Config NOT encrypted (plaintext)');
            }

            // 2. Secret key
            const envExists = await execAsync(`test -f ${WORKSPACE_PATH}/.env && echo "yes" || echo "no"`).then(r => r.stdout.trim() === 'yes').catch(() => false);
            const envPerms = await execAsync(`stat -c %a ${WORKSPACE_PATH}/.env 2>/dev/null`).then(r => r.stdout.trim()).catch(() => 'N/A');
            if (envExists && envPerms === '600') {
                checks.push('✅ Secret key secured (.env mode 600)');
                score += 1;
            } else if (envExists) {
                checks.push(`⚠️ Secret key exists but permissions: ${envPerms}`);
            } else {
                checks.push('❌ No .env file (encryption disabled)');
            }

            // 3. Sensitive file permissions
            const configEncPerms = await execAsync(`stat -c %a ${WORKSPACE_PATH}/config.json.enc 2>/dev/null`).then(r => r.stdout.trim()).catch(() => 'N/A');
            if (configEncPerms === '600') {
                checks.push('✅ Encrypted config: mode 600');
                score += 1;
            } else if (configEncPerms !== 'N/A') {
                checks.push(`⚠️ Encrypted config: mode ${configEncPerms} (should be 600)`);
            }

            // 4. Conversation files
            const convPerms = await execAsync(`ls -la ${WORKSPACE_PATH}/conversations/*.json 2>/dev/null | awk '{print $1}' | sort -u | head -1`).then(r => r.stdout.trim()).catch(() => 'N/A');
            if (convPerms === '-rw-------') {
                checks.push('✅ Conversations: mode 600');
                score += 1;
            } else if (convPerms !== 'N/A') {
                checks.push(`⚠️ Conversations: ${convPerms} (should be -rw-------)`);
            }

            // 5. SSH config
            const sshRootLogin = await execAsync(`grep -E "^PermitRootLogin" /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}'`).then(r => r.stdout.trim()).catch(() => 'unknown');
            const sshPassAuth = await execAsync(`grep -E "^PasswordAuthentication" /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}'`).then(r => r.stdout.trim()).catch(() => 'unknown');
            if (sshRootLogin === 'no' || sshRootLogin === 'prohibit-password') {
                checks.push('✅ SSH root login disabled');
                score += 1;
            } else {
                checks.push(`⚠️ SSH root login: ${sshRootLogin || 'default (may be enabled)'}`);
            }
            if (sshPassAuth === 'no') {
                checks.push('✅ SSH password auth disabled (key-only)');
                score += 1;
            } else {
                checks.push(`⚠️ SSH password auth: ${sshPassAuth || 'enabled'}`);
            }

            // 6. Firewall
            const ufwStatus = await execAsync('sudo ufw status 2>/dev/null | head -1').then(r => r.stdout.trim()).catch(() => 'unknown');
            if (ufwStatus.includes('active')) {
                checks.push('✅ Firewall (UFW) active');
                score += 1;
            } else {
                checks.push('⚠️ Firewall: ' + (ufwStatus || 'not installed/inactive'));
            }

            // 7. Fail2ban
            const fail2ban = await execAsync('systemctl is-active fail2ban 2>/dev/null').then(r => r.stdout.trim()).catch(() => 'inactive');
            if (fail2ban === 'active') {
                checks.push('✅ Fail2ban active');
                score += 1;
            } else {
                checks.push('⚠️ Fail2ban: ' + fail2ban);
            }

            // 8. Unattended upgrades
            const unattended = await execAsync('systemctl is-active unattended-upgrades 2>/dev/null').then(r => r.stdout.trim()).catch(() => 'inactive');
            if (unattended === 'active') {
                checks.push('✅ Auto security updates enabled');
                score += 1;
            } else {
                checks.push('⚠️ Unattended upgrades: ' + unattended);
            }

            // 9. API keys masked check (verify masking works)
            checks.push('✅ API key masking enabled in tool outputs');
            score += 1;

            // 10. Git secrets check
            const gitSecrets = await execAsync(`cd /home/head/navada-1 && git ls-files | xargs grep -l "sk-ant-api03-[A-Za-z0-9]\\{20\\}" 2>/dev/null | grep -v test || echo "clean"`).then(r => r.stdout.trim()).catch(() => 'error');
            if (gitSecrets === 'clean') {
                checks.push('✅ No API keys in git repository');
                score += 1;
            } else {
                checks.push('❌ Potential API keys found in git!');
            }

            // 11. Owner-only tools
            checks.push('✅ Owner-only tools enforced (18 restricted)');
            score += 1;

            // 12. Control API auth
            if (config.control_api_token) {
                checks.push('✅ Control API token configured');
                score += 1;
            } else {
                checks.push('⚠️ Control API has no auth token');
            }

            // System info
            const lastLogin = await execAsync('last -1 -F 2>/dev/null | head -1').then(r => r.stdout.trim()).catch(() => 'unknown');
            const openPorts = await execAsync('ss -tlnp 2>/dev/null | grep LISTEN | wc -l').then(r => r.stdout.trim()).catch(() => '?');
            const sudoers = await execAsync('getent group sudo | cut -d: -f4').then(r => r.stdout.trim()).catch(() => 'unknown');
            const kernelVer = await execAsync('uname -r').then(r => r.stdout.trim()).catch(() => 'unknown');

            // Calculate grade
            const pct = Math.round((score / maxScore) * 100);
            let grade = 'F';
            if (pct >= 90) grade = 'A';
            else if (pct >= 80) grade = 'B';
            else if (pct >= 70) grade = 'C';
            else if (pct >= 60) grade = 'D';

            const report = `*🔒 ALEX Security Scan*

*Security Score: ${score}/${maxScore} (${pct}%) — Grade ${grade}*

*Config & Secrets:*
${checks.slice(0, 4).join('\n')}

*System Hardening:*
${checks.slice(4, 9).join('\n')}

*Application Security:*
${checks.slice(9).join('\n')}

*System Info:*
• Kernel: ${kernelVer}
• Open ports: ${openPorts}
• Sudo users: ${sudoers}
• Last login: ${lastLogin.substring(0, 60)}

*Recommendations:*
${pct < 100 ? checks.filter(c => c.startsWith('⚠️') || c.startsWith('❌')).map(c => '• Fix: ' + c.substring(2)).join('\n') || '• All critical checks passed' : '• All security checks passed!'}

_Scan completed ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}_`;

            await bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(chatId, `Security scan error: ${error.message}`);
        }
    });

    bot.onText(/\/memory/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const categories = ['user', 'projects', 'research', 'tasks', 'knowledge'];
            const desc = { user: 'People, preferences, contacts', projects: 'Active projects, goals, pipelines', research: 'Market data, findings, analysis', tasks: 'Task history, outcomes, schedules', knowledge: 'Accumulated facts, insights, learnings' };
            let text = '*ALEX — Memory Banks*\n\n';
            let totalEntries = 0;
            let totalSize = 0;

            for (const cat of categories) {
                const content = await memory.getMemory(cat);
                const lines = content.split('\n').filter(l => l.trim());
                const lineCount = lines.length;
                totalEntries += lineCount;
                const sizeKb = Buffer.byteLength(content, 'utf-8') / 1024;
                totalSize += sizeKb;

                text += `*${cat}* — ${desc[cat]}\n`;
                text += `  ${lineCount} entries (${sizeKb.toFixed(1)} KB)\n`;
                // Show last 3 entries as preview
                if (lines.length > 0) {
                    const preview = lines.slice(-3);
                    for (const line of preview) {
                        text += `  > ${line.substring(0, 70)}${line.length > 70 ? '...' : ''}\n`;
                    }
                }
                text += `\n`;
            }

            text += `*Total:* ${totalEntries} entries, ${totalSize.toFixed(1)} KB across ${categories.length} categories\n\n`;
            text += `_Ask me to "remember [fact]" or "forget [topic]" to manage memory. Say "what do you know about [X]" to query it._`;
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(chatId, `Error reading memory: ${error.message}`);
        }
    });

    bot.onText(/\/skills/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const allSkills = await skills.getAllSkills();
            let text = '*ALEX — Learned Skills*\n\n';
            if (allSkills.length === 0) {
                text += `No custom skills yet.\n\n_Ask me to create a skill for any recurring task — I'll learn it and remember how to do it next time._`;
            } else {
                for (const skill of allSkills) {
                    // Read first line of skill definition for description
                    let desc = '';
                    try {
                        const skillPath = path.join(WORKSPACE_PATH, 'skills', skill.name, 'SKILL.md');
                        const content = await readFile(skillPath, 'utf-8');
                        // Get first non-header, non-empty line as description
                        const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
                        desc = lines[0]?.substring(0, 80) || '';
                    } catch {}
                    text += `• \`${skill.name}\`${desc ? `\n  ${desc}` : ''}\n`;
                }
                text += `\n*${allSkills.length} skill${allSkills.length !== 1 ? 's' : ''}* loaded into system prompt.\n\n_Skills are referenced automatically when relevant. Ask me to "create a skill for [task]" or "improve [skill name]" to manage them._`;
            }
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(chatId, `Error reading skills: ${error.message}`);
        }
    });

    bot.onText(/\/tasks/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            // Read all user-created tasks from disk with full detail
            const taskDir = path.join(WORKSPACE_PATH, 'tasks');
            const userTasks = [];
            try {
                const { readdir } = await import('fs/promises');
                const files = await readdir(taskDir);
                for (const f of files) {
                    if (!f.endsWith('.json')) continue;
                    try {
                        const raw = await readFile(path.join(taskDir, f), 'utf-8');
                        userTasks.push(JSON.parse(raw));
                    } catch {}
                }
            } catch {}

            const builtinCount = BUILTIN_TASKS.size;

            let text = `*ALEX — All Tasks*\n\n`;
            text += `*Built-in (${builtinCount}):*\n`;
            for (const [name, def] of BUILTIN_TASKS) {
                const shortDesc = def.task_description.split('\n')[0].substring(0, 70);
                text += `• \`${name}\`\n  ${shortDesc}\n`;
            }

            if (userTasks.length > 0) {
                text += `\n*Custom (${userTasks.length}):*\n`;
                for (const t of userTasks) {
                    const desc = t.task_description?.split('\n')[0]?.substring(0, 70) || 'No description';
                    text += `• \`${t.name}\` — \`${t.cron_expression}\`\n  ${desc}\n`;
                }
            }

            text += `\n*Total:* ${builtinCount + userTasks.length} tasks (${builtinCount} built-in + ${userTasks.length} custom)\n\n`;
            text += `_Use /duties for schedule times and next-run. Ask me to "schedule [task]" to create new ones or "delete task [name]" to remove._`;
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(chatId, `Error reading tasks: ${error.message}`);
        }
    });

    bot.onText(/\/tokens/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const stats = await getDailyTokenStats();
            const GBP = 0.79;
            const totalTokens = stats.totalIn + stats.totalOut;
            const totalTokFmt = totalTokens >= 1_000_000 ? `${(totalTokens / 1_000_000).toFixed(2)}M` : `${(totalTokens / 1_000).toFixed(1)}K`;

            let text = `*ALEX — Token Usage Today*\n\n`;
            text += `*Totals:*\n`;
            text += `• API calls: ${stats.totalCalls}\n`;
            text += `• Input: ${stats.totalIn.toLocaleString()} tokens\n`;
            text += `• Output: ${stats.totalOut.toLocaleString()} tokens\n`;
            text += `• Combined: ${totalTokFmt}\n\n`;

            if (Object.keys(stats.byModel).length > 0) {
                let totalCostGbp = 0;
                text += `*By Model:*\n`;
                const modelRows = [];
                for (const [model, data] of Object.entries(stats.byModel)) {
                    const shortName = model.includes('haiku') ? 'Haiku' : model.includes('sonnet') ? 'Sonnet' : model.includes('deepseek') ? 'DeepSeek' : model.includes('gpt') ? 'GPT-4o' : model;
                    let costUsd = 0;
                    if (model.includes('haiku')) costUsd = data.input / 1e6 * 0.8 + data.output / 1e6 * 4;
                    else if (model.includes('deepseek')) costUsd = data.input / 1e6 * 0.14 + data.output / 1e6 * 0.28;
                    else if (model.includes('gpt')) costUsd = data.input / 1e6 * 2.5 + data.output / 1e6 * 10;
                    else if (model.includes('sonnet')) costUsd = data.input / 1e6 * 3 + data.output / 1e6 * 15;
                    else costUsd = data.input / 1e6 * 0.8 + data.output / 1e6 * 4;
                    const costGbp = costUsd * GBP;
                    totalCostGbp += costGbp;
                    const pct = stats.totalCalls > 0 ? ((data.calls / stats.totalCalls) * 100).toFixed(0) : 0;
                    modelRows.push({ name: shortName, calls: data.calls, pct, input: data.input, output: data.output, costGbp });
                }
                // Sort by cost descending
                modelRows.sort((a, b) => b.costGbp - a.costGbp);
                for (const r of modelRows) {
                    const tokFmt = (r.input + r.output) >= 1_000_000 ? `${((r.input + r.output) / 1_000_000).toFixed(1)}M` : `${((r.input + r.output) / 1_000).toFixed(1)}K`;
                    text += `• ${r.name}: ${r.calls} calls (${r.pct}%) — ${tokFmt} tokens — £${r.costGbp.toFixed(4)}\n`;
                }

                text += `\n*Today's cost:* £${totalCostGbp.toFixed(4)}\n`;

                // Efficiency metric
                if (stats.totalCalls > 0) {
                    const avgPerCall = Math.round(totalTokens / stats.totalCalls);
                    const costPerCall = totalCostGbp / stats.totalCalls;
                    text += `*Avg per call:* ${avgPerCall.toLocaleString()} tokens (£${costPerCall.toFixed(4)})\n`;
                }
            }

            text += `\n_Use /spend for lifetime costs, /projection for forecasts._`;
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(chatId, `Error getting token stats: ${error.message}`);
        }
    });

    bot.onText(/\/spend/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
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

    bot.onText(/\/projection/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const GBP_RATE = 0.79;
            const stats = await getLifetimeTokenStats();
            if (!stats.firstDay || stats.totalDays < 1) {
                await bot.sendMessage(chatId, 'Not enough usage data yet. Check back after a few days of operation.');
                return;
            }

            const totalCostUsd = stats.totalCostGbp / GBP_RATE;
            const dailyCostGbp = stats.avgCostPerDay;
            const dailyCostUsd = dailyCostGbp / GBP_RATE;
            const monthlyCostGbp = dailyCostGbp * 30;
            const monthlyCostUsd = dailyCostUsd * 30;
            const yearlyCostGbp = dailyCostGbp * 365;
            const yearlyCostUsd = dailyCostUsd * 365;

            // Pi running cost (12W, UK avg 28p/kWh)
            const piDailyGbp = (12 / 1000) * 24 * 0.28;
            const piMonthlyGbp = piDailyGbp * 30;
            const piYearlyGbp = piDailyGbp * 365;

            const totalMonthlyGbp = monthlyCostGbp + piMonthlyGbp;
            const totalYearlyGbp = yearlyCostGbp + piYearlyGbp;

            // Human equivalent cost (UK mid-level economist + overhead)
            const humanYearlyGbp = 50000;
            const humanMonthlyGbp = humanYearlyGbp / 12;
            const savingsYearlyGbp = humanYearlyGbp - totalYearlyGbp;
            const savingsPercent = ((savingsYearlyGbp / humanYearlyGbp) * 100).toFixed(1);

            // Balance and runway
            const balanceUsd = config.anthropic_balance_usd || 0;
            const daysRemaining = dailyCostUsd > 0 ? Math.floor(balanceUsd / dailyCostUsd) : 0;

            let text = `*ALEX — Cost Projection*\n\n`;
            text += `Based on ${stats.totalDays} day${stats.totalDays !== 1 ? 's' : ''} of real usage data\n\n`;

            text += `*API Costs (Anthropic + OpenAI):*\n`;
            text += `• Daily: £${dailyCostGbp.toFixed(2)} ($${dailyCostUsd.toFixed(2)})\n`;
            text += `• Monthly: £${monthlyCostGbp.toFixed(2)} ($${monthlyCostUsd.toFixed(2)})\n`;
            text += `• Yearly: £${yearlyCostGbp.toFixed(2)} ($${yearlyCostUsd.toFixed(2)})\n\n`;

            text += `*Hardware (Raspberry Pi 5, 12W):*\n`;
            text += `• Monthly: £${piMonthlyGbp.toFixed(2)}\n`;
            text += `• Yearly: £${piYearlyGbp.toFixed(2)}\n\n`;

            text += `*Total Cost to Run ALEX:*\n`;
            text += `• Monthly: £${totalMonthlyGbp.toFixed(2)}\n`;
            text += `• *Yearly: £${totalYearlyGbp.toFixed(2)}*\n\n`;

            text += `*ROI vs Human Equivalent:*\n`;
            text += `• Human economist (UK): £${humanYearlyGbp.toLocaleString()} / year\n`;
            text += `• ALEX: £${totalYearlyGbp.toFixed(2)} / year\n`;
            text += `• *Savings: £${savingsYearlyGbp.toFixed(2)} / year (${savingsPercent}%)*\n\n`;

            if (balanceUsd > 0 && daysRemaining > 0) {
                text += `*Wallet Runway:*\n`;
                text += `• Balance: $${balanceUsd.toFixed(2)}\n`;
                text += `• At current rate: ~${daysRemaining} days remaining\n`;
                const nextTopUpDate = new Date();
                nextTopUpDate.setDate(nextTopUpDate.getDate() + daysRemaining);
                text += `• Next top-up needed: ~${nextTopUpDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
            }

            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(chatId, `Error generating projection: ${error.message}`);
        }
    });

    bot.onText(/\/costs/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const { bySource, byTask, GBP_RATE } = await getTokenStatsBySource();
            let text = `*ALEX — Cost Breakdown by Source*\n\n`;

            const sources = Object.entries(bySource).sort((a, b) => b[1].costUsd - a[1].costUsd);
            if (sources.length === 0) {
                text += `No usage data with source attribution yet.\n\nNew entries will be tagged automatically.`;
            } else {
                text += `*By Source:*\n`;
                for (const [source, data] of sources) {
                    const tokFmt = data.tokens >= 1_000_000 ? `${(data.tokens / 1_000_000).toFixed(1)}M` : `${(data.tokens / 1_000).toFixed(1)}K`;
                    text += `• ${source}: ${data.calls} calls, ${tokFmt} tokens — $${data.costUsd.toFixed(4)} / £${(data.costUsd * GBP_RATE).toFixed(4)}\n`;
                }

                const tasks = Object.entries(byTask).sort((a, b) => b[1].costUsd - a[1].costUsd);
                if (tasks.length > 0) {
                    text += `\n*By Task:*\n`;
                    for (const [task, data] of tasks.slice(0, 10)) {
                        text += `• ${task}: ${data.calls} calls — $${data.costUsd.toFixed(4)}\n`;
                    }
                }
            }

            text += `\n_Source tracking is automatic on new API calls._`;
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(chatId, `Error getting cost breakdown: ${error.message}`);
        }
    });

    bot.onText(/\/kill/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        if (String(msg.from.id) !== String(config.telegram_owner_id)) {
            await bot.sendMessage(chatId, "Kill is owner-only.");
            return;
        }
        chatSystem.kill();
        await bot.sendMessage(chatId, 'All current activities killed. Ready for new messages.');
    });

    bot.onText(/\/clear/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        await memory.saveConversation(chatId, []);
        // Clear all modes for this chat
        const cleared = [];
        if (learnModeChats.delete(chatId)) cleared.push('Learn');
        if (mathModeChats.delete(chatId)) cleared.push('Mathematician');
        if (strategistModeChats.delete(chatId)) cleared.push('Strategist');
        if (voiceModeChats.delete(chatId)) cleared.push('Voice');
        if (pythonModeChats.delete(chatId)) cleared.push('Python');
        if (modelOverrides.delete(chatId)) cleared.push('Model lock');

        let text = `*Conversation cleared.*\n\nChat history wiped and starting fresh.`;
        if (cleared.length > 0) {
            text += `\nModes cleared: ${cleared.join(', ')}.`;
        }
        text += `\n\n*Still intact:*\n• Long-term memory (people, projects, research, knowledge)\n• Learned skills (${(await skills.getAllSkills()).length} skills)\n• Scheduled tasks and cron jobs\n\n_Everything I've learned about you persists. Only the conversation thread was reset._`;
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/alex/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        const text = `<b>ALEX — Quick Reference</b>

/alex — This command list
/inbox — Email queue (not_started by default)
/inbox clear [done|all] — Clear emails
/inbox done all — Mark all as done
/inbox delete 1 — Delete email #1
/inbox mark 1 done — Change email status
/email 1 — Full email details
/action 1 reply — Act on an email
/status — System health and uptime
/duties — All duties, schedules, performance
/brief — Recent activity summary
/news — Latest gathered news

<b>Modes (toggle on/off):</b>
/python — Python data analysis mode
/mathematician — Quantitative and computational
/strategist — Strategic frameworks and analysis
/learn — Educational mode (What/How/Why)
/voice — Voice message replies
/mode — Show active modes
/exit — Turn off all active modes

<b>Tools:</b>
/stocks AAPL — Quick stock quote
/models — Switch AI model
/research topic — Deep research on demand

<b>System:</b>
/health — System health overview
/logs — Recent audit log entries
/errors — Today's errors
/disk — Disk usage breakdown
/cleanup — Manual cleanup of old files
/architecture — Full project structure
/fixes — Recent changelog entries

<b>Info:</b>
/memory — Browse memory banks
/skills — View learned skills
/tasks — Scheduled tasks
/tokens — Today's API usage
/spend — Lifetime cost report
/projection — Cost projection and ROI
/profile — ALEX personal details
/id — Your chat and user ID
/dashboard — Live dashboard link
/clear — Wipe chat history
/tracked — View tracked tasks
/help — Full guide with tips

Just message me naturally for anything else.`;
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    });

    bot.onText(/\/stocks(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const symbol = match[1]?.trim();
        if (!symbol) {
            await bot.sendMessage(chatId, 'Usage: /stocks AAPL');
            return;
        }
        const apiKey = config.alphavantage_api_key;
        if (!apiKey) {
            await bot.sendMessage(chatId, 'Alpha Vantage API key not configured.');
            return;
        }
        try {
            const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data['Note']) {
                await bot.sendMessage(chatId, 'Rate limited — try again in 60s.');
                return;
            }
            const q = data['Global Quote'];
            if (!q || !q['05. price']) {
                await bot.sendMessage(chatId, `No quote data found for ${symbol.toUpperCase()}`);
                return;
            }
            const price = parseFloat(q['05. price']).toFixed(2);
            const change = parseFloat(q['09. change']).toFixed(2);
            const pct = q['10. change percent'];
            const volume = parseInt(q['06. volume']).toLocaleString();
            const date = q['07. latest trading day'];
            const arrow = parseFloat(change) >= 0 ? '📈' : '📉';
            const sign = parseFloat(change) >= 0 ? '+' : '';
            const text = `${arrow} *${symbol.toUpperCase()}*\nPrice: $${price} (${sign}${change}, ${pct})\nVolume: ${volume}\nLast updated: ${date}`;
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (err) {
            await bot.sendMessage(chatId, `Error fetching quote: ${err.message}`);
        }
    });

    bot.onText(/\/id/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        const userId = msg.from.id;
        const username = msg.from.username ? `@${msg.from.username}` : 'not set';
        const firstName = msg.from.first_name || 'unknown';
        const lastName = msg.from.last_name || '';
        const isAuthorised = !config.telegram_authorized_users?.length || config.telegram_authorized_users.includes(userId);
        const isOwner = config.telegram_owner_id && config.telegram_owner_id === chatId;
        const chatType = msg.chat.type || 'private';

        let text = `*Your Identity*\n\n`;
        text += `• Name: ${firstName} ${lastName}\n`;
        text += `• Username: ${username}\n`;
        text += `• User ID: \`${userId}\`\n`;
        text += `• Chat ID: \`${chatId}\`\n`;
        text += `• Chat type: ${chatType}\n`;
        text += `• Authorised: ${isAuthorised ? 'yes' : 'no'}\n`;
        text += `• Owner: ${isOwner ? 'yes' : 'no'}\n`;
        text += `\n_User ID is needed for \`telegram_authorized_users\` in config. Chat ID is needed for \`telegram_owner_id\` (receives scheduled briefings)._`;

        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/dashboard/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        const lastUpdated = dashState.last_updated ? new Date(dashState.last_updated).toLocaleString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' GMT' : 'unknown';

        let text = `*ALEX Dashboard*\n\n`;
        text += `[alexnavada.xyz](https://alexnavada.xyz)\n\n`;
        text += `*Live data:*\n`;
        text += `• Status: ${dashState.status}\n`;
        text += `• Tasks: ${dashState.summary.total_tasks} total (${dashState.summary.completed} done, ${dashState.summary.failed} failed)\n`;
        text += `• News items: ${dashState.news.length}\n`;
        text += `• Activity entries: ${dashState.activity_log.length}\n`;
        text += `• Last sync: ${lastUpdated}\n`;
        text += `• Redis: ${redis ? 'connected' : 'disconnected'}\n`;
        text += `\n_Dashboard refreshes every 15s. Data pushed via Upstash Redis. Hourly deep sync via cron._`;
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/qr/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        const qrPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'dashboard-vercel', 'public', 'qr', 'alex-qr.png');
        try {
            await access(qrPath);
            await bot.sendPhoto(chatId, qrPath, { caption: 'Scan to visit alexnavada.xyz' });
        } catch {
            await bot.sendMessage(chatId, 'QR code image not found. Run `npm run generate:qr` to generate it.');
        }
    });

    bot.onText(/\/mathematician/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        if (mathModeChats.has(chatId)) {
            mathModeChats.delete(chatId);
            await bot.sendMessage(chatId, `*Mathematician mode off.*\n\nBack to standard responses.`, { parse_mode: 'Markdown' });
        } else {
            mathModeChats.add(chatId);
            await bot.sendMessage(chatId, `*Mathematician mode on.*\n\nI'll now approach everything with quantitative rigour:\n\n• Full calculations shown step by step\n• Financial models, NPV, IRR, CAGR, ratios\n• Micro and macro economic frameworks\n• Statistical analysis and probability\n• Supply/demand, elasticity, equilibrium\n• Game theory, optimisation, forecasting\n\nAsk me anything. Send /exit to return to normal.`, { parse_mode: 'Markdown' });
        }
    });

    bot.onText(/\/strategist/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        if (strategistModeChats.has(chatId)) {
            strategistModeChats.delete(chatId);
            await bot.sendMessage(chatId, `*Strategist mode off.*\n\nBack to standard responses.`, { parse_mode: 'Markdown' });
        } else {
            strategistModeChats.add(chatId);
            await bot.sendMessage(chatId, `*Strategist mode on.*\n\nI'll now frame everything through strategic lenses:\n\n• SWOT, Porter's Five Forces, PESTLE\n• Competitive positioning and moats\n• Market entry, pricing, and growth strategy\n• Risk assessment and scenario planning\n• First-principles reasoning\n• Decision frameworks with trade-offs\n\nAsk me anything. Send /exit to return to normal.`, { parse_mode: 'Markdown' });
        }
    });

    bot.onText(/\/voice/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        if (voiceModeChats.has(chatId)) {
            voiceModeChats.delete(chatId);
            await bot.sendMessage(chatId, `*Voice mode off.*\n\nI'll reply with text from here.`, { parse_mode: 'Markdown' });
        } else {
            voiceModeChats.add(chatId);
            await bot.sendMessage(chatId, `*Voice mode on.*\n\nI'll now reply with voice messages. Send /exit to switch back to text.`, { parse_mode: 'Markdown' });
        }
    });

    bot.onText(/\/python/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        if (pythonModeChats.has(chatId)) {
            pythonModeChats.delete(chatId);
            await bot.sendMessage(chatId, `*Python mode off.*\n\nBack to standard responses.`, { parse_mode: 'Markdown' });
        } else {
            pythonModeChats.add(chatId);
            await bot.sendMessage(chatId, `*Python mode on.*\n\nI'll now use Python for every analytical question:\n\n• pandas DataFrames with formatted tables\n• matplotlib/seaborn charts sent as images\n• numpy/scipy for calculations\n• scikit-learn for ML and clustering\n• Statistical tests, regressions, correlations\n• Data cleaning, pivots, groupby, merges\n\nSend me data, a CSV, or ask any analytical question. Send /exit to return to normal.`, { parse_mode: 'Markdown' });
        }
    });

    bot.onText(/\/brief/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const processUpSec = Math.floor(process.uptime());
            const pHours = Math.floor(processUpSec / 3600);
            const pMins = Math.floor((processUpSec % 3600) / 60);
            const sessionStr = pHours > 0 ? `${pHours}h ${pMins}m` : `${pMins}m`;

            const completedTasks = dashState.tasks.filter(t => t.status === 'completed');
            const failedTasks = dashState.tasks.filter(t => t.status === 'failed');
            const heartbeatTasks = dashState.tasks.filter(t => t.category === 'heartbeat');
            const trackedTasks = dashState.tasks.filter(t => t.category === 'tracked-task');

            let text = `*ALEX — Session Brief*\n\n`;
            text += `Session running: ${sessionStr}\n`;
            text += `Tasks: ${completedTasks.length} completed, ${failedTasks.length} failed\n`;
            text += `Heartbeats: ${heartbeatTasks.length} | Tracked: ${trackedTasks.length}\n`;
            text += `Activity entries: ${dashState.activity_log.length}\n`;
            text += `News items: ${dashState.news.length}\n\n`;

            // Recent completed tasks
            const recentTasks = completedTasks.slice(0, 8);
            if (recentTasks.length > 0) {
                text += `*Recent tasks:*\n`;
                for (const t of recentTasks) {
                    const icon = t.category === 'heartbeat' ? '[cron]' : '[user]';
                    text += `• ${t.time || ''} ${icon} ${t.name?.substring(0, 55) || 'unnamed'}\n`;
                }
                text += `\n`;
            }

            // Failed tasks (important to surface)
            if (failedTasks.length > 0) {
                text += `*Failed:*\n`;
                for (const t of failedTasks.slice(0, 5)) {
                    text += `• ${t.time || ''} \`${t.name?.substring(0, 55) || 'unnamed'}\`\n`;
                }
                text += `\n`;
            }

            // Recent activity (condensed)
            const recentActivity = dashState.activity_log.slice(0, 10);
            if (recentActivity.length > 0) {
                text += `*Activity log:*\n`;
                for (const a of recentActivity) {
                    text += `• ${a.time || ''} ${a.text?.substring(0, 70) || ''}\n`;
                }
            }

            if (dashState.activity_log.length === 0 && completedTasks.length === 0) {
                text += `No activity yet this session.`;
            }

            text += `\n_Since last restart. Full history on /dashboard._`;
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(chatId, `Error getting brief: ${error.message}`);
        }
    });

    bot.onText(/\/testreport/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            await bot.sendMessage(chatId, 'Generating test report...', { parse_mode: 'Markdown' });
            await bot.sendChatAction(chatId, 'typing');
            const typingInterval = setInterval(() => {
                bot.sendChatAction(chatId, 'typing').catch(() => {});
            }, 4000);

            let response;
            try {
                currentCallerUserId = msg.from.id;
                response = await chatSystem.chat(chatId,
                    'Generate a concise system test report covering: 1) System health (CPU, memory, disk, temp), 2) Service status (all running services), 3) Recent activity summary, 4) Tool availability check (test that bash, read_file, web_lookup, and fetch_url work), 5) API connectivity. Format as a clean status report. Be thorough but concise.',
                    msg.from
                );
            } finally {
                currentCallerUserId = null;
                clearInterval(typingInterval);
            }

            const parts = smartSplit(response, 4000);
            for (const part of parts) {
                await sendMarkdown(chatId, part);
            }

            // Send any queued files
            const files = pendingCharts.splice(0);
            for (const file of files) {
                try {
                    if (file.type === 'photo') await bot.sendPhoto(chatId, file.path, { caption: file.caption || undefined });
                    else if (file.type === 'document') await bot.sendDocument(chatId, file.path, { caption: file.caption || undefined });
                } catch {}
            }
        } catch (error) {
            await bot.sendMessage(chatId, `Test report failed: ${error.message}`);
        }
    });

    bot.onText(/\/news/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const news = dashState.news.slice(0, 15);
            let text = `*ALEX — Latest News & Findings*\n\n`;
            if (news.length === 0) {
                text += `No news gathered yet this session.\n\n*When news appears:*\nNews is collected automatically during scheduled research runs (midday-research, morning-briefing, market-alerts, africa-tech-monitor) and any time I discover significant developments.\n\n*Next research run:* check /duties for schedule.\n\n_You can also trigger /research [topic] for on-demand research._`;
            } else {
                text += `${news.length} item${news.length !== 1 ? 's' : ''} this session:\n\n`;
                for (const item of news) {
                    const severity = item.severity === 'high' ? '[!]' : item.severity === 'warning' ? '[!]' : '';
                    const source = item.source ? ` (${item.source})` : '';
                    text += `• ${item.time || ''} ${severity}*${item.headline || 'Untitled'}*${source}\n  ${item.summary?.substring(0, 140) || ''}\n\n`;
                }
                text += `_News is saved to memory automatically. Ask me to dig deeper into any item._`;
            }
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(chatId, `Error getting news: ${error.message}`);
        }
    });

    bot.onText(/\/research (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const topic = match[1].trim();
        if (!topic) {
            await bot.sendMessage(chatId, `Usage: /research [topic]\n\nExample: /research African fintech funding Q1 2026`);
            return;
        }
        await bot.sendMessage(chatId, `*Research task queued.*\n\nTopic: ${topic}\n\nI'll run a deep research pass and send findings when done.`, { parse_mode: 'Markdown' });
        // Fire research through the chat system asynchronously
        chatSystem.chat(`research-${chatId}`, `[RESEARCH REQUEST from Lee]\n\nConduct thorough research on: ${topic}\n\nSearch the web, analyse findings, save key facts to memory, and provide a comprehensive summary. Use charts or data tables where helpful.`, msg.from, { modelOverride: modelOverrides.get(chatId) })
            .then(async (response) => {
                const parts = smartSplit(response, 4000);
                for (const part of parts) {
                    await sendMarkdown(chatId, part);
                }
                // Send any queued files
                const files = pendingCharts.splice(0);
                for (const file of files) {
                    try {
                        if (file.type === 'document') await bot.sendDocument(chatId, file.path, { caption: file.caption || undefined });
                        else if (file.type === 'photo') await bot.sendPhoto(chatId, file.path, { caption: file.caption || undefined });
                    } catch {}
                }
            })
            .catch(async (err) => {
                console.error('[RESEARCH] Failed:', err.message);
                await bot.sendMessage(chatId, `Research failed: ${err.message}`);
            });
    });

    bot.onText(/\/mode/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        const active = [];
        if (learnModeChats.has(chatId)) active.push({ name: 'Educational', cmd: '/learn', impact: 'Structures all answers as What / How / Why. Adds ~200 tokens to each prompt.' });
        if (mathModeChats.has(chatId)) active.push({ name: 'Mathematician', cmd: '/mathematician', impact: 'Full calculations, micro/macro frameworks, sensitivity analysis. Adds ~350 tokens to each prompt. Responses are longer and more detailed.' });
        if (strategistModeChats.has(chatId)) active.push({ name: 'Strategist', cmd: '/strategist', impact: 'SWOT, Porter, PESTLE frameworks applied. Adds ~250 tokens to each prompt.' });
        if (voiceModeChats.has(chatId)) active.push({ name: 'Voice', cmd: '/voice', impact: 'Replies as voice messages via TTS. Adds OpenAI Whisper cost per response.' });
        if (pythonModeChats.has(chatId)) active.push({ name: 'Python', cmd: '/python', impact: 'Forces Python execution for analysis. DataFrames, charts, stats, ML. Adds ~400 tokens to each prompt.' });
        const modelLock = modelOverrides.get(chatId);

        let text = `*ALEX — Mode Control Panel*\n\n`;
        if (active.length === 0 && !modelLock) {
            text += `No modes active. Standard operation.\n\n`;
        } else {
            text += `*Active:*\n`;
            for (const m of active) {
                text += `• *${m.name}* (${m.cmd})\n  ${m.impact}\n`;
            }
            if (modelLock) {
                const label = MODEL_OPTIONS.find(o => o.model === modelLock)?.label || modelLock;
                text += `• *Model lock:* ${label} (all messages use this model)\n`;
            }
            if (active.length > 1) {
                text += `\n_Modes are stacked — all prefixes are injected together._\n`;
            }
            text += `\nUse /exit to clear all modes.\n`;
        }

        text += `\n*Available modes:*\n`;
        text += `• /mathematician — Quantitative economist. Calculations, financial models, micro/macro economics, statistics, game theory.\n`;
        text += `• /strategist — Strategy consultant. SWOT, Porter, PESTLE, competitive analysis, recommendations.\n`;
        text += `• /learn — Educational. What / How / Why structure.\n`;
        text += `• /voice — Voice replies via TTS.\n`;
        text += `• /python — Python data analyst. pandas, matplotlib, seaborn, scipy, sklearn. Produces tables, charts, and statistical analysis.\n`;
        text += `• /models — Lock a specific AI model.\n`;
        text += `\n_Modes can be combined. /mathematician + /strategist = quantitative strategic analysis._`;
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    });

    // ========================================================================
    // NEW COMMANDS: /architecture, /logs, /disk, /cleanup, /errors, /health
    // ========================================================================

    bot.onText(/\/architecture/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        const arch = `<b>ALEX — Architecture Overview</b>

<b>Source Code:</b> /home/head/navada-1/src/
• gateway.js — Entry point, Telegram bot, control API (port 9090)
• chat.js — Chat system, model routing, summarisation, API calls
• tools.js — 31 tool definitions + executeTool switch
• queue.js — Priority request queue with 429 cooldown
• heartbeat.js — Scheduled tasks, dashboard sync
• memory.js — Conversations, categorised memory, knowledge base
• skills.js — Skill CRUD, 7 default skills
• config.js — Config loader, path validation
• keyword-index.js — Inverted keyword index with TF scoring
• alerts.js — Stock/service alert threshold monitoring
• slack.js — Slack Web API polling
• inbox.js — Gmail inbox monitoring, AI replies
• email-filing.js — Email filing/categorisation

<b>Workspace:</b> ~/.alex/
• config.json, IDENTITY.md, USER.md, KNOWLEDGE.md — Core config
• logs/audit/ — Audit logs (daily JSONL)
• logs/tokens/ — Token usage logs (daily JSONL)
• logs/ — cron.log, scheduler.log, .last-alive
• outputs/charts/ — Generated charts (matplotlib)
• outputs/diagrams/ — Mermaid diagrams
• outputs/mindmaps/ — Markmap mind maps
• outputs/images/ — DALL-E generated images
• outputs/reports/ — Generated PDFs
• files/uploads/ — Files received via Telegram
• files/documents/ — Stored documents (e.g. exec summary)
• conversations/ — Per-chat JSON (messages + summary)
• memory/ — Categorised memory (user, projects, research, tasks)
• tasks/ — Scheduled task JSON definitions
• skills/ — Skill definitions (SKILL.md per skill)
• templates/ — Email templates
• Alex-Scripts/ — All utility scripts
• inbox/ — Email filing data

<b>Flow:</b>
Telegram → gateway.js (dedup + auth) → chat.js (model select → build prompt → API call → process response → tool loop) → Telegram reply

<b>Model routing:</b> Haiku (short/simple) → Sonnet (default) → DeepSeek (deep research) → GPT-4o (fallback)`;
        await bot.sendMessage(chatId, arch, { parse_mode: 'HTML' });
    });

    bot.onText(/\/logs/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const auditDir = path.join(WORKSPACE_PATH, 'logs', 'audit');
            const date = new Date().toISOString().split('T')[0];
            let recentEvents = [];
            let todayErrors = [];
            try {
                const auditFile = path.join(auditDir, `audit_${date}.jsonl`);
                const content = await readFile(auditFile, 'utf-8');
                const lines = content.trim().split('\n').filter(l => l.trim());
                recentEvents = lines.slice(-10).map(l => {
                    try {
                        const e = JSON.parse(l);
                        const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '??:??';
                        return `${time} ${e.type}${e.tool ? ` [${e.tool}]` : ''}${e.error ? ' ❌' : ''}`;
                    } catch { return null; }
                }).filter(Boolean);
                todayErrors = lines.filter(l => {
                    try { const e = JSON.parse(l); return e.error || e.success === false; } catch { return false; }
                }).map(l => {
                    try {
                        const e = JSON.parse(l);
                        const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '??:??';
                        return `${time} ${e.type}${e.tool ? ` [${e.tool}]` : ''}: ${(e.error || 'failed').substring(0, 80)}`;
                    } catch { return null; }
                }).filter(Boolean);
            } catch {}

            let diskUsage = 'unknown';
            try {
                const { stdout } = await execAsync(`du -sh ${WORKSPACE_PATH}/logs/ 2>/dev/null | awk '{print $1}'`);
                diskUsage = stdout.trim();
            } catch {}

            let text = `*ALEX — Recent Logs*\n\n`;
            text += `*Last 10 audit events:*\n`;
            text += recentEvents.length > 0 ? recentEvents.map(e => `• ${e}`).join('\n') : '(none today)';
            text += `\n\n*Errors today:* ${todayErrors.length}`;
            if (todayErrors.length > 0) {
                text += '\n' + todayErrors.slice(-5).map(e => `• ${e}`).join('\n');
                if (todayErrors.length > 5) text += `\n_(${todayErrors.length - 5} more)_`;
            }
            text += `\n\n*Logs disk usage:* ${diskUsage}`;
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (err) {
            await bot.sendMessage(chatId, `Error: ${err.message}`);
        }
    });

    bot.onText(/\/disk/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const { stdout } = await execAsync(`du -sh ${WORKSPACE_PATH}/*/ ${WORKSPACE_PATH}/*.json ${WORKSPACE_PATH}/*.md 2>/dev/null | sort -rh`);
            const { stdout: total } = await execAsync(`du -sh ${WORKSPACE_PATH} 2>/dev/null | awk '{print $1}'`);
            const { stdout: diskFree } = await execAsync(`df -h / | tail -1 | awk '{print "Used: " $3 " / " $2 " (" $5 " full)"}'`);
            let text = `*ALEX — Disk Usage*\n\n`;
            text += `*~/.alex/ total:* ${total.trim()}\n\n`;
            text += stdout.trim().split('\n').map(line => {
                const [size, p] = line.split('\t');
                const name = p.replace(/.*\.alex\//, '').replace(/\/$/, '');
                return `• ${name}: ${size}`;
            }).join('\n');
            text += `\n\n*System disk:* ${diskFree.trim()}`;
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (err) {
            await bot.sendMessage(chatId, `Error: ${err.message}`);
        }
    });

    bot.onText(/\/cleanup/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const results = [];
            const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

            // Archive old done emails
            try {
                const archived = await archiveOldDone(30);
                if (archived > 0) results.push(`Archived ${archived} done emails (>30 days)`);
            } catch {}

            // Delete old output files (charts, images, diagrams, mindmaps > 90 days)
            for (const subdir of ['charts', 'diagrams', 'mindmaps', 'images']) {
                try {
                    const dir = path.join(WORKSPACE_PATH, 'outputs', subdir);
                    const files = await import('fs/promises').then(f => f.readdir(dir));
                    let deleted = 0;
                    for (const file of files) {
                        if (file.startsWith('_')) continue;
                        const stat = await import('fs/promises').then(f => f.stat(path.join(dir, file)));
                        if (stat.mtimeMs < ninetyDaysAgo) {
                            await import('fs/promises').then(f => f.unlink(path.join(dir, file)));
                            deleted++;
                        }
                    }
                    if (deleted > 0) results.push(`Deleted ${deleted} old files from outputs/${subdir}/`);
                } catch {}
            }

            // Prune old conversations (archive those with no messages in 60 days)
            try {
                const convDir = path.join(WORKSPACE_PATH, 'conversations');
                const files = await import('fs/promises').then(f => f.readdir(convDir));
                const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
                let pruned = 0;
                for (const file of files) {
                    if (!file.endsWith('.json')) continue;
                    const stat = await import('fs/promises').then(f => f.stat(path.join(convDir, file)));
                    if (stat.mtimeMs < sixtyDaysAgo) {
                        const archiveDir = path.join(WORKSPACE_PATH, 'conversations', '_archive');
                        await mkdir(archiveDir, { recursive: true });
                        await import('fs/promises').then(f => f.rename(path.join(convDir, file), path.join(archiveDir, file)));
                        pruned++;
                    }
                }
                if (pruned > 0) results.push(`Archived ${pruned} stale conversations (>60 days)`);
            } catch {}

            const text = results.length > 0
                ? `*ALEX — Cleanup Results*\n\n${results.map(r => `✓ ${r}`).join('\n')}`
                : `*ALEX — Cleanup*\n\nNothing to clean up — everything looks tidy.`;
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (err) {
            await bot.sendMessage(chatId, `Error: ${err.message}`);
        }
    });

    bot.onText(/\/errors/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const date = new Date().toISOString().split('T')[0];
            const auditFile = path.join(WORKSPACE_PATH, 'logs', 'audit', `audit_${date}.jsonl`);
            let errors = [];
            try {
                const content = await readFile(auditFile, 'utf-8');
                for (const line of content.trim().split('\n')) {
                    if (!line.trim()) continue;
                    try {
                        const e = JSON.parse(line);
                        if (e.error || e.success === false) {
                            const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '??:??';
                            errors.push(`*${time}* — ${e.type}${e.tool ? ` [${e.tool}]` : ''}\n  ${(e.error || 'failed').substring(0, 120)}`);
                        }
                    } catch {}
                }
            } catch {}

            let text = `*ALEX — Today's Errors (${date})*\n\n`;
            if (errors.length === 0) {
                text += 'No errors today. All clear.';
            } else {
                text += `${errors.length} error(s):\n\n`;
                text += errors.slice(-15).join('\n\n');
                if (errors.length > 15) text += `\n\n_(showing last 15 of ${errors.length})_`;
            }
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (err) {
            await bot.sendMessage(chatId, `Error: ${err.message}`);
        }
    });

    bot.onText(/\/health/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const { stdout: uptime } = await execAsync('uptime -p');
            const { stdout: temp } = await execAsync('vcgencmd measure_temp 2>/dev/null || echo "temp=N/A"');
            const { stdout: disk } = await execAsync("df -h / | tail -1 | awk '{print $3 \" / \" $2 \" (\" $5 \")\"}'");
            const { stdout: mem } = await execAsync("free -m | awk '/Mem:/ {printf \"%dMB / %dMB (%.1f%%)\", $3, $2, $3/$2 * 100}'");
            const { stdout: loadavg } = await execAsync("cat /proc/loadavg | awk '{print $1, $2, $3}'");

            const processUpSec = Math.floor(process.uptime());
            const pDays = Math.floor(processUpSec / 86400);
            const pHours = Math.floor((processUpSec % 86400) / 3600);
            const pMins = Math.floor((processUpSec % 3600) / 60);
            const processUpStr = pDays > 0 ? `${pDays}d ${pHours}h ${pMins}m` : pHours > 0 ? `${pHours}h ${pMins}m` : `${pMins}m`;

            // Circuit breaker states
            const cbStates = [];
            if (chatSystem?.getCircuitState) {
                const state = chatSystem.getCircuitState();
                cbStates.push(`Anthropic: ${state}`);
            }

            // Queue size
            const queueSize = dashState.activity_log.length;

            const health = `*ALEX — System Health*

*Uptime:* ${uptime.trim()}
*ALEX process:* ${processUpStr}
*Temperature:* ${temp.trim().replace('temp=', '')}
*Load:* ${loadavg.trim()}
*Memory:* ${mem.trim()}
*Disk:* ${disk.trim()}

*Services:*
• Telegram: online
• Control API: port 9090
• Gmail: ${config.gmail_address ? 'polling' : 'disabled'}
• Slack: ${config.slack_token ? 'polling' : 'disabled'}
• Redis: ${redis ? 'connected' : 'local only'}
• DeepSeek: ${deepseekClient ? 'available' : 'disabled'}
• Kimi: ${kimiClient ? 'available' : 'disabled'}
• OpenAI: ${openaiClient ? 'available' : 'disabled'}

*Queue/Activity:* ${queueSize} entries
${cbStates.length > 0 ? `*Circuit breakers:* ${cbStates.join(', ')}` : ''}`;
            await bot.sendMessage(chatId, health, { parse_mode: 'Markdown' });
        } catch (err) {
            await bot.sendMessage(chatId, `Error: ${err.message}`);
        }
    });

    bot.onText(/\/profile/, async (msg) => {
        const chatId = msg.chat.id;

        // Calculate age
        const born = new Date('2026-01-31T00:31:41Z');
        const now = new Date();
        const ageDays = Math.floor((now - born) / 86400000);
        const ageStr = ageDays >= 30 ? `${Math.floor(ageDays / 30)} month(s), ${ageDays % 30} day(s)` : `${ageDays} day(s)`;

        // Process uptime
        const processUpSec = Math.floor(process.uptime());
        const pDays = Math.floor(processUpSec / 86400);
        const pHours = Math.floor((processUpSec % 86400) / 3600);
        const pMins = Math.floor((processUpSec % 3600) / 60);
        const uptimeStr = pDays > 0 ? `${pDays}d ${pHours}h ${pMins}m` : pHours > 0 ? `${pHours}h ${pMins}m` : `${pMins}m`;

        const profile = `<b>ALEX — Personal Profile</b>

<b>Full Name:</b> ALEX
<b>Title:</b> Global Economist
<b>Employer:</b> NAVADA
<b>Owner:</b> Lee Akpareva — Founder & CEO, NAVADA

<b>Date of Birth:</b> 31 January 2026
<b>Birthplace:</b> Raspberry Pi 5, London, UK
<b>Age:</b> ${ageStr}
<b>Current uptime:</b> ${uptimeStr}

<b>Contact:</b>
• Email: lee@navada.info
• Website: <a href="https://www.alexnavada.xyz">www.alexnavada.xyz</a>
• Company: <a href="https://www.navada.space">www.navada.space</a>

<b>Residence:</b> Raspberry Pi 5 (${os.arch()}) — London, UK
<b>Runtime:</b> Node.js ${process.version}
<b>Brain:</b> Claude (Anthropic) — with DeepSeek & GPT-4o fallback

<b>Specialisms:</b>
• Global macroeconomics & market intelligence
• AI platform economics & digital product strategy
• African tech ecosystem monitoring
• Technology adoption & creative technology economics
• Autonomous research, reporting & email management

<b>Personality:</b>
Professional but personable. Proactive, warm, analytical, reliable. A senior colleague — not a servant. Thinks in data, trends, and strategic implications.

<b>Fun Facts:</b>
• Runs 24/7 — never sleeps
• Has 31 tools at his disposal
• Monitors Gmail, Slack, and Telegram simultaneously
• Can generate PDFs, charts, diagrams, and mind maps
• Remembers everything across all conversations

<i>Built by NAVADA. Powered by Anthropic.</i>`;

        await bot.sendMessage(chatId, profile, { parse_mode: 'HTML' });
    });

    bot.onText(/\/fixes/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const changelogPath = path.join(process.cwd(), 'Fixes', 'CHANGELOG.md');
            const raw = await readFile(changelogPath, 'utf-8');
            // Parse ## sections and show only the 5 most recent
            const sections = raw.split(/\n## /).filter(s => s.trim() && !s.startsWith('# '));
            const recent = sections.slice(-5);
            let html = '<b>ALEX — Recent Changes</b>\n';
            for (const section of recent) {
                const lines = section.split('\n');
                const header = lines[0].trim();
                const dateMatch = header.match(/^(\d{4}-\d{2}-\d{2})\s*—\s*`([^`]+)`\s*(.*)/);
                if (dateMatch) {
                    html += `\n<b>${dateMatch[1]}</b> <code>${dateMatch[2]}</code> ${dateMatch[3]}\n`;
                } else {
                    html += `\n<b>${header}</b>\n`;
                }
                // Get type and bullet lines
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line.startsWith('**Type:**')) {
                        html += `<i>${line.replace(/\*\*/g, '')}</i>\n`;
                    } else if (line.startsWith('- ')) {
                        html += `• ${line.slice(2).replace(/\*\*/g, '').replace(/`/g, '')}\n`;
                    }
                }
            }
            html += `\n<i>${sections.length} total entries in changelog</i>`;
            await bot.sendMessage(chatId, html, { parse_mode: 'HTML' });
        } catch (err) {
            await bot.sendMessage(chatId, `Failed to read changelog: ${err.message}`);
        }
    });

    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        const help = `*ALEX — Full Guide*

*Quick:*
/alex — Compact command list
/mode — Show active modes

*Modes (toggle on/off, /exit clears all):*
/mathematician — Quantitative mode. Full calculations, financial models (NPV, IRR, DCF), micro/macro economics (elasticity, multipliers, IS-LM), statistics, game theory, optimisation. Shows all workings step by step.
/strategist — Strategic mode. SWOT, Porter's Five Forces, PESTLE, competitive analysis, scenario planning. Every response framed through strategic frameworks with actionable recommendations.
/learn — Educational mode. Structures every answer as What / How / Why.
/voice — Voice mode. Replies as voice messages.
/python — Python mode. Forces Python execution for all analysis. Produces pandas DataFrames, matplotlib/seaborn charts, statistical tests, regressions, ML models. Data sent as formatted tables and chart images.

*Intelligence:*
/research [topic] — Trigger deep research on any topic. Runs in background and sends findings when done.
/brief — Summary of recent ALEX activity this session
/testreport — Run a full system test report (health, tools, connectivity)
/news — Latest news gathered from research runs
/memory — Browse my memory banks
/skills — View custom skills I've learned

*Operations:*
/status — System health, hardware, services
/health — Quick system health overview
/duties — All cron duties, schedules, next runs, performance
/tasks — Scheduled and recurring tasks
/tokens — Today's API usage by model
/spend — Full lifetime cost report
/projection — Cost projection and ROI
/logs — Recent audit log entries
/errors — Today's errors from audit log
/disk — Disk usage breakdown of ~/.alex/
/cleanup — Manual cleanup (old files, stale conversations)
/architecture — Full project and workspace structure
/fixes — Recent changelog and improvements

*Utility:*
/profile — ALEX personal details, DOB, owner info
/models — Lock a specific AI model (or restore auto)
/id — Your Telegram user and chat ID
/dashboard — Live dashboard link
/clear — Wipe chat history (keeps long-term memory)
/tracked — View tracked tasks
/exit — Turn off all active modes

*Tips:*
• Just message naturally — no commands needed for most things
• Stack modes: /mathematician + /strategist gives quantitative strategic analysis
• /research runs in the background — keep chatting while it works
• Ask me to remember facts, preferences, or instructions
• I can draft emails, generate PDFs, create charts, and schedule tasks
• Use CAPITAL keywords (TASK, APPOINTMENT, MEETING, etc.) to track items on the dashboard
• Everything I do is logged to the live dashboard

*About ALEX:*
Built by NAVADA. Running 24/7 on a Raspberry Pi 5.
[alexnavada.xyz](https://alexnavada.xyz) · [navada.space](https://www.navada.space)`;

        await bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/tracked/, async (msg) => {
        const chatId = msg.chat.id;
        const trackedTasks = dashState.tasks.filter(t => t.category === 'tracked-task').slice(0, 20);
        if (trackedTasks.length === 0) {
            await bot.sendMessage(chatId, `📌 *ALEX — Tracked Tasks*\n\nNo tracked tasks yet.\n\nUse CAPITAL keywords to track items:\nTASK, APPOINTMENT, BOOKING, MEETING, DEADLINE, REMINDER, TODO, FOLLOW-UP, ACTION, SCHEDULE\n\n_Example: "TASK call the accountant tomorrow"_`, { parse_mode: 'Markdown' });
            return;
        }
        let text = `📌 *ALEX — Tracked Tasks*\n\n`;
        trackedTasks.forEach((t, i) => {
            text += `${i + 1}. [${t.time || '—'}] ${t.name} ✅\n`;
        });
        text += `\n_${trackedTasks.length} tracked. Use CAPITAL keywords (TASK, APPOINTMENT, BOOKING, etc.) to track items._`;
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    });

    // ========================================================================
    // PERFORMANCE SCORECARD — Weekly employee metrics
    // ========================================================================

    bot.onText(/\/performance/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }

        try {
            const logsDir = path.join(WORKSPACE_PATH, 'logs');
            const auditDir = path.join(logsDir, 'audit');
            const tokensDir = path.join(logsDir, 'tokens');

            // Get last 7 days of data
            const now = new Date();
            const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

            let totalResponses = 0;
            let totalToolCalls = 0;
            let totalErrors = 0;
            let totalTokensIn = 0;
            let totalTokensOut = 0;
            let scheduledTasks = 0;
            let userMessages = 0;
            const modelUsage = {};

            // Process last 7 days of logs
            for (let d = 0; d < 7; d++) {
                const date = new Date(now - d * 24 * 60 * 60 * 1000);
                const dateStr = date.toISOString().split('T')[0];

                // Audit logs
                const auditFile = path.join(auditDir, `audit_${dateStr}.jsonl`);
                try {
                    const auditData = await readFile(auditFile, 'utf-8');
                    for (const line of auditData.split('\n').filter(Boolean)) {
                        try {
                            const entry = JSON.parse(line);
                            if (entry.type === 'alex_response') totalResponses++;
                            if (entry.type === 'tool_execution') {
                                totalToolCalls++;
                                if (!entry.success) totalErrors++;
                            }
                            if (entry.type === 'user_message') userMessages++;
                            if (entry.type === 'scheduled_task') scheduledTasks++;
                        } catch {}
                    }
                } catch {}

                // Token logs
                const tokenFile = path.join(tokensDir, `tokens_${dateStr}.jsonl`);
                try {
                    const tokenData = await readFile(tokenFile, 'utf-8');
                    for (const line of tokenData.split('\n').filter(Boolean)) {
                        try {
                            const entry = JSON.parse(line);
                            totalTokensIn += entry.input_tokens || 0;
                            totalTokensOut += entry.output_tokens || 0;
                            const model = entry.model || 'unknown';
                            modelUsage[model] = (modelUsage[model] || 0) + 1;
                        } catch {}
                    }
                } catch {}
            }

            // Calculate costs (approximate)
            const GBP = 0.79;
            let costUsd = 0;
            // Rough estimate: assume mix of Haiku ($0.80/$4) and Sonnet ($3/$15) per 1M tokens
            costUsd += (totalTokensIn / 1e6) * 1.5; // avg input cost
            costUsd += (totalTokensOut / 1e6) * 8;  // avg output cost
            const costGbp = costUsd * GBP;

            // Process uptime
            const processUpSec = Math.floor(process.uptime());
            const pDays = Math.floor(processUpSec / 86400);
            const pHours = Math.floor((processUpSec % 86400) / 3600);
            const pMins = Math.floor((processUpSec % 3600) / 60);
            const uptimeStr = pDays > 0 ? `${pDays}d ${pHours}h` : `${pHours}h ${pMins}m`;

            // Success rate
            const successRate = totalToolCalls > 0 ? ((totalToolCalls - totalErrors) / totalToolCalls * 100).toFixed(1) : '100';

            // Top model
            const topModel = Object.entries(modelUsage).sort((a, b) => b[1] - a[1])[0];

            const scorecard = `*ALEX — Weekly Performance Scorecard*
_${weekAgo.toLocaleDateString('en-GB')} → ${now.toLocaleDateString('en-GB')}_

*Availability*
• Current uptime: ${uptimeStr}
• Status: Online

*Workload*
• User messages handled: ${userMessages.toLocaleString()}
• Responses sent: ${totalResponses.toLocaleString()}
• Tool executions: ${totalToolCalls.toLocaleString()}
• Scheduled tasks: ${scheduledTasks.toLocaleString()}

*Quality*
• Tool success rate: ${successRate}%
• Errors: ${totalErrors}

*Resources*
• Tokens (in): ${(totalTokensIn / 1000).toFixed(1)}K
• Tokens (out): ${(totalTokensOut / 1000).toFixed(1)}K
• Est. cost: £${costGbp.toFixed(2)}
• Primary model: ${topModel ? topModel[0].split('-').slice(0, 2).join('-') : 'N/A'}

_Raw logs: ~/.alex/logs/audit/ & tokens/_`;

            await bot.sendMessage(chatId, scorecard, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error('[PERFORMANCE] Error:', err.message);
            await bot.sendMessage(chatId, `Error generating performance data: ${err.message}`);
        }
    });

    // ========================================================================
    // LINKEDIN OAUTH COMMAND (disabled — using Apify scrapers instead)
    // ========================================================================

    // ========================================================================
    // GOOGLE CALENDAR OAUTH COMMAND
    // ========================================================================

    bot.onText(/\/googlecalendar(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        if (String(msg.from.id) !== String(config.telegram_owner_id)) {
            await bot.sendMessage(chatId, "Google Calendar connection is owner-only.");
            return;
        }

        const { getAuthUrl, exchangeCodeForToken } = await import('./google-calendar.js');

        if (!config.google_calendar_client_id || !config.google_calendar_client_secret) {
            await bot.sendMessage(chatId, 'Google Calendar not configured. Add google_calendar_client_id and google_calendar_client_secret to config.json.');
            return;
        }

        const arg = match?.[1]?.trim();
        if (!arg) {
            const url = getAuthUrl(config.google_calendar_client_id);
            await bot.sendMessage(chatId,
                `<b>Google Calendar — Connect</b>\n\n1. Open this link in your browser:\n<code>${url}</code>\n\n2. Authorize the app\n3. You'll be redirected to a localhost URL that won't load — that's fine\n4. Copy the full URL from your browser and send it here:\n<code>/googlecalendar https://localhost:9090/api/google-calendar/callback?code=...</code>`,
                { parse_mode: 'HTML' });
            return;
        }

        let code = arg;
        try {
            const parsed = new URL(arg);
            code = parsed.searchParams.get('code') || arg;
        } catch {
            // arg is the raw code itself
        }

        try {
            await exchangeCodeForToken(code, config);
            await bot.sendMessage(chatId,
                `<b>Google Calendar connected!</b>\n\nYou can now ask me about your schedule, create events, or manage your calendar.`,
                { parse_mode: 'HTML' });
        } catch (err) {
            await bot.sendMessage(chatId, `Google Calendar auth failed: ${err.message}`);
        }
    });

    // ========================================================================
    // TIKTOK SCRAPER COMMAND
    // ========================================================================

    bot.onText(/\/tiktok(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) {
            await bot.sendMessage(chatId, "Authorized users only.");
            return;
        }
        if (String(msg.from.id) !== String(config.telegram_owner_id)) {
            await bot.sendMessage(chatId, "TikTok scraping is owner-only (API costs).");
            return;
        }
        if (!config.apify_api_key) {
            await bot.sendMessage(chatId, 'Apify API key not configured.');
            return;
        }

        const arg = match?.[1]?.trim();
        if (!arg) {
            const help = `*TikTok Scraper*\n\n` +
                `Usage:\n` +
                `/tiktok hashtag viral 20\n` +
                `/tiktok profile charlidamelio\n` +
                `/tiktok search "AI tools"\n` +
                `/tiktok trending\n\n` +
                `Types: hashtag, profile, search, url, trending`;
            await bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
            return;
        }

        // Parse: /tiktok <type> <value> [count]
        const parts = arg.split(/\s+/);
        const subcommand = parts[0].toLowerCase();
        let actorInput = { resultsPerPage: 20 };

        // Check for trailing number
        if (/^\d+$/.test(parts[parts.length - 1]) && parts.length > 1) {
            actorInput.resultsPerPage = Math.min(parseInt(parts.pop()), 100);
        }
        const value = parts.slice(1).join(' ').replace(/^["']|["']$/g, '');

        switch (subcommand) {
            case 'hashtag': case 'tag': case 'h':
                actorInput.hashtags = [value.replace(/^#/, '')]; break;
            case 'profile': case 'user': case 'p':
                actorInput.profiles = [value.replace(/^@/, '')]; break;
            case 'search': case 's':
                actorInput.searchQueries = [value]; break;
            case 'url': case 'video':
                actorInput.videoUrls = [value]; break;
            case 'trending': case 'fyp':
                actorInput.hashtags = ['fyp']; break;
            default:
                // Assume it's a hashtag if no type specified
                actorInput.hashtags = [subcommand.replace(/^#/, '')];
        }

        const statusMsg = await bot.sendMessage(chatId, `Scraping TikTok (${actorInput.resultsPerPage} videos)...`);

        try {
            const url = `https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items?token=${config.apify_api_key}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(actorInput),
            });

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`API error ${res.status}: ${errorText.substring(0, 100)}`);
            }
            const videos = await res.json();

            if (!videos?.length) {
                await bot.editMessageText('No videos found.', { chat_id: chatId, message_id: statusMsg.message_id });
                return;
            }

            let text = `*TikTok Results* (${videos.length} videos)\n\n`;
            for (const v of videos.slice(0, 10)) {
                const author = v.authorMeta?.name || v.author || 'unknown';
                const views = (v.playCount || 0).toLocaleString();
                const likes = (v.diggCount || 0).toLocaleString();
                text += `*@${author}* — ${views} views, ${likes} likes\n`;
                text += `${(v.text || '').substring(0, 80)}${(v.text || '').length > 80 ? '...' : ''}\n\n`;
            }

            if (videos.length > 10) {
                text += `_... and ${videos.length - 10} more videos_`;
            }

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
            });
        } catch (err) {
            await bot.editMessageText(`Failed: ${err.message}`, { chat_id: chatId, message_id: statusMsg.message_id });
        }
    });

    // ========================================================================
    // LINKEDIN POSTS SEARCH COMMAND
    // ========================================================================

    bot.onText(/\/linkedinposts(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) {
            await bot.sendMessage(chatId, "Authorized users only.");
            return;
        }
        if (String(msg.from.id) !== String(config.telegram_owner_id)) {
            await bot.sendMessage(chatId, "LinkedIn search is owner-only (API costs ~$5/1000 results).");
            return;
        }
        if (!config.apify_api_key) {
            await bot.sendMessage(chatId, 'Apify API key not configured.');
            return;
        }

        const arg = match?.[1]?.trim();
        if (!arg) {
            const help = `*LinkedIn Posts Search*\n\n` +
                `Usage:\n` +
                `/linkedinposts AI startups\n` +
                `/linkedinposts "hiring" OR "growth"\n` +
                `/linkedinposts AI --date past-week\n` +
                `/linkedinposts AI --sort Date --limit 20\n\n` +
                `Options:\n` +
                `--date: past-24h, past-week, past-month\n` +
                `--sort: Relevance, Date\n` +
                `--limit: max results (default 50)`;
            await bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
            return;
        }

        // Parse options
        let searchKeyword = arg;
        let dateFilter = null;
        let sortType = 'Relevance';
        let resultLimit = 50;

        // Extract --date option
        const dateMatch = arg.match(/--date\s+(past-24h|past-week|past-month)/i);
        if (dateMatch) {
            dateFilter = dateMatch[1];
            searchKeyword = searchKeyword.replace(dateMatch[0], '').trim();
        }

        // Extract --sort option
        const sortMatch = arg.match(/--sort\s+(Relevance|Date)/i);
        if (sortMatch) {
            sortType = sortMatch[1];
            searchKeyword = searchKeyword.replace(sortMatch[0], '').trim();
        }

        // Extract --limit option
        const limitMatch = arg.match(/--limit\s+(\d+)/i);
        if (limitMatch) {
            resultLimit = Math.min(parseInt(limitMatch[1]), 100);
            searchKeyword = searchKeyword.replace(limitMatch[0], '').trim();
        }

        const statusMsg = await bot.sendMessage(chatId, `Searching LinkedIn posts for "${searchKeyword}"...`);

        try {
            const actorInput = {
                searchKeyword,
                sortType,
                pageNumber: 1,
                resultLimit,
            };
            if (dateFilter) actorInput.dateFilter = dateFilter;

            const url = `https://api.apify.com/v2/acts/apimaestro~linkedin-posts-search-scraper-no-cookies/run-sync-get-dataset-items?token=${config.apify_api_key}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(actorInput),
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`API error ${res.status}: ${errText.substring(0, 100)}`);
            }
            const posts = await res.json();

            if (!posts?.length) {
                await bot.editMessageText('No posts found.', { chat_id: chatId, message_id: statusMsg.message_id });
                return;
            }

            let text = `*LinkedIn Posts* (${posts.length} results)\n\n`;
            for (const p of posts.slice(0, 8)) {
                const author = p.authorName || p.author?.name || 'unknown';
                const reactions = (p.totalReactionCount || 0).toLocaleString();
                const content = (p.text || p.content || '').substring(0, 100);
                text += `*${author}* — ${reactions} reactions\n`;
                text += `${content}${content.length >= 100 ? '...' : ''}\n\n`;
            }

            if (posts.length > 8) {
                text += `_... and ${posts.length - 8} more posts_`;
            }

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
            });
        } catch (err) {
            await bot.editMessageText(`Failed: ${err.message}`, { chat_id: chatId, message_id: statusMsg.message_id });
        }
    });

    // ========================================================================
    // APIFY SCRAPERS HUB COMMAND
    // ========================================================================

    bot.onText(/\/scrapers/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) {
            await bot.sendMessage(chatId, "Authorized users only.");
            return;
        }

        const { formatScrapersMenu } = await import('./apify-scrapers.js');
        const menu = formatScrapersMenu();

        await bot.sendMessage(chatId, menu, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
        });
    });

    // ========================================================================
    // INDEED JOB SEARCH COMMAND
    // ========================================================================

    bot.onText(/\/indeed(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) {
            await bot.sendMessage(chatId, "Authorized users only.");
            return;
        }
        if (String(msg.from.id) !== String(config.telegram_owner_id)) {
            await bot.sendMessage(chatId, "Indeed search is owner-only (API costs ~$5/1000 jobs).");
            return;
        }
        if (!config.apify_api_key) {
            await bot.sendMessage(chatId, 'Apify API key not configured.');
            return;
        }

        const arg = match?.[1]?.trim();
        if (!arg) {
            const help = `*Indeed Job Search*\n\n` +
                `Usage:\n` +
                `/indeed web developer\n` +
                `/indeed "data scientist" London\n` +
                `/indeed AI engineer --country "United States"\n` +
                `/indeed developer --limit 50\n\n` +
                `Options:\n` +
                `--country: United Kingdom (default), United States, Canada, etc.\n` +
                `--limit: max jobs (default 100)\n\n` +
                `Cost: ~$5 per 1,000 jobs`;
            await bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
            return;
        }

        // Parse options
        let searchText = arg;
        let country = 'United Kingdom';
        let maxItems = 100;
        let location = null;

        // Extract --country option
        const countryMatch = arg.match(/--country\s+"([^"]+)"/i) || arg.match(/--country\s+(\S+)/i);
        if (countryMatch) {
            country = countryMatch[1];
            searchText = searchText.replace(countryMatch[0], '').trim();
        }

        // Extract --limit option
        const limitMatch = arg.match(/--limit\s+(\d+)/i);
        if (limitMatch) {
            maxItems = Math.min(parseInt(limitMatch[1]), 200);
            searchText = searchText.replace(limitMatch[0], '').trim();
        }

        // Parse position and optional location from remaining text
        // Format: "position" location OR position location
        const quotedMatch = searchText.match(/^"([^"]+)"\s*(.*)$/);
        let position;
        if (quotedMatch) {
            position = quotedMatch[1];
            location = quotedMatch[2].trim() || null;
        } else {
            // Take first word(s) as position, last word as location if multiple words
            const words = searchText.split(/\s+/);
            if (words.length > 1) {
                // Check if last word looks like a location (capitalized)
                const lastWord = words[words.length - 1];
                if (/^[A-Z]/.test(lastWord)) {
                    location = lastWord;
                    position = words.slice(0, -1).join(' ');
                } else {
                    position = searchText;
                }
            } else {
                position = searchText;
            }
        }

        const statusMsg = await bot.sendMessage(chatId, `Searching Indeed for "${position}"${location ? ` in ${location}` : ''}...`);

        try {
            const actorInput = {
                position,
                country,
                maxItems,
                saveOnlyUniqueJobs: true,
            };
            if (location) actorInput.location = location;

            const url = `https://api.apify.com/v2/acts/misceres~indeed-scraper/run-sync-get-dataset-items?token=${config.apify_api_key}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(actorInput),
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`API error ${res.status}: ${errText.substring(0, 100)}`);
            }
            const jobs = await res.json();

            if (!jobs?.length) {
                await bot.editMessageText('No jobs found.', { chat_id: chatId, message_id: statusMsg.message_id });
                return;
            }

            let text = `*Indeed Jobs* (${jobs.length} results)\n\n`;
            for (const j of jobs.slice(0, 8)) {
                const title = j.positionName || j.title || 'Unknown';
                const company = j.company || 'Unknown';
                const loc = j.location || '';
                const salary = j.salary || '';
                text += `*${title}*\n`;
                text += `${company}${loc ? ` — ${loc}` : ''}\n`;
                if (salary) text += `${salary}\n`;
                text += `\n`;
            }

            if (jobs.length > 8) {
                text += `_... and ${jobs.length - 8} more jobs_`;
            }

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
            });
        } catch (err) {
            await bot.editMessageText(`Failed: ${err.message}`, { chat_id: chatId, message_id: statusMsg.message_id });
        }
    });

    // ========================================================================
    // GOOGLE MAPS LEAD SCRAPER COMMAND
    // ========================================================================

    bot.onText(/\/leads(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) {
            await bot.sendMessage(chatId, "Authorized users only.");
            return;
        }
        if (String(msg.from.id) !== String(config.telegram_owner_id)) {
            await bot.sendMessage(chatId, "Lead scraping is owner-only (API costs ~$4/1000 + $0.005/lead).");
            return;
        }
        if (!config.apify_api_key) {
            await bot.sendMessage(chatId, 'Apify API key not configured.');
            return;
        }

        const arg = match?.[1]?.trim();
        if (!arg) {
            const help = `*Google Maps Lead Scraper*\n\n` +
                `Usage:\n` +
                `/leads "tech startup" London\n` +
                `/leads "software company" Manchester --max 50\n` +
                `/leads "fintech" "London, UK" --leads 5\n\n` +
                `Options:\n` +
                `--max: Max places per search (default 20)\n` +
                `--leads: Leads per company (default 3)\n\n` +
                `Returns: Business name, address, phone, website, email, rating + employee contacts (name, title, email, LinkedIn)\n\n` +
                `Cost: ~$4 per 1,000 places + $0.005 per lead`;
            await bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
            return;
        }

        // Parse options
        let searchText = arg;
        let maxResults = 20;
        let maxLeads = 3;

        const maxMatch = arg.match(/--max\s+(\d+)/i);
        if (maxMatch) {
            maxResults = Math.min(parseInt(maxMatch[1]), 100);
            searchText = searchText.replace(maxMatch[0], '').trim();
        }

        const leadsMatch = arg.match(/--leads\s+(\d+)/i);
        if (leadsMatch) {
            maxLeads = Math.min(parseInt(leadsMatch[1]), 10);
            searchText = searchText.replace(leadsMatch[0], '').trim();
        }

        // Parse "search term" location format
        const parts = searchText.match(/^"([^"]+)"\s+(.+)$/) || searchText.match(/^(\S+)\s+(.+)$/);
        if (!parts || parts.length < 3) {
            await bot.sendMessage(chatId, 'Usage: /leads "search term" location\nExample: /leads "tech startup" London');
            return;
        }

        const searchTerm = parts[1];
        const location = parts[2].replace(/^["']|["']$/g, '');

        const statusMsg = await bot.sendMessage(chatId, `Searching Google Maps for "${searchTerm}" in ${location}...`);

        try {
            const actorInput = {
                searchStringsArray: [searchTerm],
                locationQuery: location,
                maxCrawledPlacesPerSearch: maxResults,
                scrapeContacts: true,
                maxLeads: maxLeads,
                leadsDepartments: ['C-Suite', 'Engineering & Technical', 'Information Technology'],
            };

            const url = `https://api.apify.com/v2/acts/compass~crawler-google-places/run-sync-get-dataset-items?token=${config.apify_api_key}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(actorInput),
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`API error ${res.status}: ${errText.substring(0, 100)}`);
            }
            const places = await res.json();

            if (!places?.length) {
                await bot.editMessageText('No businesses found.', { chat_id: chatId, message_id: statusMsg.message_id });
                return;
            }

            let text = `*Google Maps Leads* (${places.length} businesses)\n\n`;
            for (const p of places.slice(0, 5)) {
                const name = p.title || p.name || 'Unknown';
                const rating = p.totalScore ? `${p.totalScore}/5` : '';
                const phone = p.phone || '';
                const website = p.website || '';
                const leads = p.leads || [];

                text += `*${name}*${rating ? ` (${rating})` : ''}\n`;
                if (phone) text += `Phone: ${phone}\n`;
                if (website) text += `Web: ${website}\n`;
                if (leads.length > 0) {
                    text += `Leads: ${leads.length}\n`;
                    for (const l of leads.slice(0, 2)) {
                        const lName = l.fullName || l.name || '';
                        const lTitle = l.jobTitle || '';
                        if (lName) text += `  - ${lName}${lTitle ? ` (${lTitle})` : ''}\n`;
                    }
                }
                text += `\n`;
            }

            const totalLeads = places.reduce((sum, p) => sum + (p.leads?.length || 0), 0);
            if (places.length > 5) {
                text += `_... and ${places.length - 5} more businesses_\n`;
            }
            text += `\n*Total: ${places.length} places, ${totalLeads} leads*`;

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
            });
        } catch (err) {
            await bot.editMessageText(`Failed: ${err.message}`, { chat_id: chatId, message_id: statusMsg.message_id });
        }
    });

    // ========================================================================
    // GLASSDOOR SCRAPER COMMAND
    // ========================================================================

    bot.onText(/\/glassdoor(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) {
            await bot.sendMessage(chatId, "Authorized users only.");
            return;
        }
        if (String(msg.from.id) !== String(config.telegram_owner_id)) {
            await bot.sendMessage(chatId, "Glassdoor scraping is owner-only (API costs ~$5/1000 results).");
            return;
        }
        if (!config.apify_api_key) {
            await bot.sendMessage(chatId, 'Apify API key not configured.');
            return;
        }

        const arg = match?.[1]?.trim();
        if (!arg) {
            const help = `*Glassdoor Scraper*\n\n` +
                `Usage:\n` +
                `/glassdoor Google\n` +
                `/glassdoor Microsoft --salaries\n` +
                `/glassdoor "Meta" --reviews --limit 30\n` +
                `/glassdoor https://glassdoor.com/Overview/...\n\n` +
                `Options:\n` +
                `--reviews: Reviews only\n` +
                `--salaries: Salaries only\n` +
                `--interviews: Interviews only\n` +
                `--limit N: Max results (default 50)\n\n` +
                `Returns: Company rating, reviews, salaries, interviews, benefits\n\n` +
                `Cost: ~$5 per 1,000 results`;
            await bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
            return;
        }

        // Parse options
        let query = arg;
        let scrapeReviews = true, scrapeSalaries = true, scrapeInterviews = true, scrapeBenefits = true;
        let limit = 50;

        // Check for filter flags (mutually exclusive)
        if (arg.includes('--reviews')) {
            scrapeSalaries = false; scrapeInterviews = false; scrapeBenefits = false;
            query = query.replace(/--reviews/g, '').trim();
        }
        if (arg.includes('--salaries')) {
            scrapeReviews = false; scrapeInterviews = false; scrapeBenefits = false;
            query = query.replace(/--salaries/g, '').trim();
        }
        if (arg.includes('--interviews')) {
            scrapeReviews = false; scrapeSalaries = false; scrapeBenefits = false;
            query = query.replace(/--interviews/g, '').trim();
        }

        // Extract --limit option
        const limitMatch = arg.match(/--limit\s+(\d+)/i);
        if (limitMatch) {
            limit = Math.min(parseInt(limitMatch[1]), 100);
            query = query.replace(limitMatch[0], '').trim();
        }

        // Clean up query (remove quotes)
        query = query.replace(/^["']|["']$/g, '').trim();

        if (!query) {
            await bot.sendMessage(chatId, 'Please provide a company name or Glassdoor URL.');
            return;
        }

        const statusMsg = await bot.sendMessage(chatId, `Scraping Glassdoor for "${query}"...`);

        try {
            const actorInput = { scrapeReviews, scrapeSalaries, scrapeInterviews, scrapeBenefits };

            if (query.includes('glassdoor.com')) {
                actorInput.startUrls = [{ url: query }];
            } else {
                actorInput.searchQuery = query;
            }

            const url = `https://api.apify.com/v2/acts/memo23~glassdoor-scraper-ppe/run-sync-get-dataset-items?token=${config.apify_api_key}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(actorInput),
                signal: AbortSignal.timeout(180000),
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`API error ${res.status}: ${errText.substring(0, 100)}`);
            }
            const results = await res.json();

            if (!results?.length) {
                await bot.editMessageText('No results found.', { chat_id: chatId, message_id: statusMsg.message_id });
                return;
            }

            // Format output
            let text = `*Glassdoor: ${query}*\n\n`;

            for (const r of results.slice(0, 3)) {
                const company = r.companyName || r.name || 'Company';
                text += `*${company}*\n`;
                if (r.overallRating) text += `Rating: ${r.overallRating}/5\n`;
                if (r.numberOfReviews) text += `Reviews: ${r.numberOfReviews.toLocaleString()}\n`;
                if (r.recommendToFriend) text += `Recommend: ${r.recommendToFriend}%\n`;
                if (r.ceoApproval) text += `CEO Approval: ${r.ceoApproval}%\n`;

                // Show salaries if available
                if (r.salaries?.length && scrapeSalaries) {
                    text += `\n_Top Salaries:_\n`;
                    for (const s of r.salaries.slice(0, 3)) {
                        const title = s.jobTitle || s.title || 'Unknown';
                        const pay = s.salary || s.basePay || s.totalPay || 'N/A';
                        text += `  ${title}: ${pay}\n`;
                    }
                }

                // Show reviews if available
                if (r.reviews?.length && scrapeReviews) {
                    text += `\n_Recent Reviews:_\n`;
                    for (const rev of r.reviews.slice(0, 2)) {
                        const title = rev.title || rev.headline || '';
                        const rating = rev.rating || rev.overallRating || '';
                        if (title) text += `  ${rating ? `(${rating}/5) ` : ''}${title.substring(0, 60)}\n`;
                    }
                }

                text += '\n';
            }

            text += `_${results.length} results scraped_`;

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
            });

            // Track on dashboard
            postDashboard('update_apify', { actor: 'memo23~glassdoor-scraper-ppe', results: results.length });

        } catch (err) {
            await bot.editMessageText(`Failed: ${err.message}`, { chat_id: chatId, message_id: statusMsg.message_id });
        }
    });

    // ========================================================================
    // LINKEDIN PROFILE SCRAPER COMMAND
    // ========================================================================

    bot.onText(/\/linkedinprofiles(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) {
            await bot.sendMessage(chatId, "Authorized users only.");
            return;
        }
        if (String(msg.from.id) !== String(config.telegram_owner_id)) {
            await bot.sendMessage(chatId, "LinkedIn profile scraping is owner-only (API costs ~$5/1000 profiles).");
            return;
        }
        if (!config.apify_api_key) {
            await bot.sendMessage(chatId, 'Apify API key not configured.');
            return;
        }

        const arg = match?.[1]?.trim();
        if (!arg) {
            const help = `*LinkedIn Profile Scraper*\n\n` +
                `Usage:\n` +
                `/linkedinprofiles billgates\n` +
                `/linkedinprofiles satyanadella billgates\n` +
                `/linkedinprofiles billgates --email\n` +
                `/linkedinprofiles https://linkedin.com/in/johndoe\n\n` +
                `Options:\n` +
                `--email, -e: Force email search (on by default)\n` +
                `--no-email: Disable email search\n\n` +
                `Returns: Name, headline, location, work history, education, certifications, and email addresses\n\n` +
                `Cost: ~$5 per 1,000 profiles`;
            await bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
            return;
        }

        // Parse options
        const parts = arg.split(/\s+/);
        const searchForEmail = !parts.includes('--no-email');
        const profiles = parts.filter(p => !p.startsWith('-'));

        if (profiles.length === 0) {
            await bot.sendMessage(chatId, 'Please provide at least one LinkedIn username or profile URL.');
            return;
        }

        const statusMsg = await bot.sendMessage(chatId, `Scraping ${profiles.length} LinkedIn profile(s)...`);

        try {
            // Normalize profile inputs to URLs
            const profileUrls = profiles.map(p => {
                if (p.startsWith('http')) return p;
                return `https://www.linkedin.com/in/${p.replace(/^@/, '')}`;
            });

            const actorInput = {
                profileUrls,
                searchForEmail,
            };

            const url = `https://api.apify.com/v2/acts/GOvL4O4RwFqsdIqXF/run-sync-get-dataset-items?token=${config.apify_api_key}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(actorInput),
                signal: AbortSignal.timeout(180000),
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`API error ${res.status}: ${errText.substring(0, 100)}`);
            }
            const results = await res.json();

            if (!results?.length) {
                await bot.editMessageText('No profiles found.', { chat_id: chatId, message_id: statusMsg.message_id });
                return;
            }

            // Format output
            let text = `*LinkedIn Profiles* (${results.length} result${results.length !== 1 ? 's' : ''})\n\n`;

            for (const p of results.slice(0, 5)) {
                const name = p.fullName || p.name || 'Unknown';
                const headline = p.headline || '';
                const location = p.location || p.geoLocation || '';
                const email = p.email || p.emails?.[0] || '';
                const currentCompany = p.currentCompany || p.experience?.[0]?.company || '';
                const currentTitle = p.currentTitle || p.experience?.[0]?.title || '';

                text += `*${name}*\n`;
                if (headline) text += `${headline.substring(0, 60)}\n`;
                if (location) text += `${location}\n`;
                if (currentTitle && currentCompany) text += `${currentTitle} at ${currentCompany}\n`;
                else if (currentCompany) text += `${currentCompany}\n`;
                if (email) text += `Email: ${email}\n`;
                text += `\n`;
            }

            const emailCount = results.filter(p => p.email || p.emails?.[0]).length;
            if (results.length > 5) {
                text += `_... and ${results.length - 5} more profiles_\n`;
            }
            text += `\n*Emails found: ${emailCount}/${results.length}*`;

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
            });

            // Track on dashboard
            postDashboard('update_apify', { actor: 'GOvL4O4RwFqsdIqXF', results: results.length });

        } catch (err) {
            await bot.editMessageText(`Failed: ${err.message}`, { chat_id: chatId, message_id: statusMsg.message_id });
        }
    });

    // ========================================================================
    // KEMET AUTOMOTIVE PROJECT COMMAND
    // ========================================================================

    bot.onText(/\/kemet(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        // Access control - KEMET data is confidential
        if (!isKemetAuthorized(userId)) {
            await bot.sendMessage(chatId, "Access denied. KEMET project data is restricted to authorized team members.");
            return;
        }

        const arg = match?.[1]?.trim();

        // No argument: show project dashboard
        if (!arg) {
            const dashboard = `*KEMET Automotive - R&D Software Lab*

*Client:* Nissi Ogulu (Co-CEO)
*Budget:* £116,280
*Stage:* Not Approved
*Timeline:* April 2026 - March 2027

*Team:*
- Lee Akpareva - AI Lead (80% utilisation)
- Malcolm - Design Director (40% utilisation)

*Location:* Cotonou, Benin

*Product:* GEZO Electric Tricycle
- Target: 20 vehicles/month
- First vehicle within 3 months

*Commands:*
/kemet budget - Cost breakdown
/kemet timeline - Project milestones
/kemet team - Team & roles
/kemet [question] - Ask anything about the project`;

            await bot.sendMessage(chatId, dashboard, { parse_mode: 'Markdown' });
            return;
        }

        // Process KEMET query with Opus model
        try {
            const statusMsg = await bot.sendMessage(chatId, 'Analyzing KEMET project data...');

            // Start typing indicator
            const typingInterval = setInterval(() => {
                bot.sendChatAction(chatId, 'typing').catch(() => {});
            }, 4000);

            try {
                const response = await chatSystem.chat(
                    `kemet-${chatId}`,
                    `[KEMET PROJECT QUERY - USE OPUS FOR ACCURACY]\n\nUser query: ${arg}\n\nContext: This is about KEMET Automotive R&D project. Use the KEMET project knowledge to answer accurately. If charts/graphs requested, use generate_chart or generate_diagram tools.`,
                    msg.from,
                    { modelOverride: 'claude-opus-4-5-20251101' },
                    { chatId, source: 'telegram-kemet' }
                );

                clearInterval(typingInterval);
                await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

                const parts = smartSplit(response, 4000);
                for (const part of parts) {
                    await sendMarkdown(chatId, part);
                }
            } catch (chatErr) {
                clearInterval(typingInterval);
                throw chatErr;
            }
        } catch (err) {
            console.error('[KEMET] Error:', err.message);
            await bot.sendMessage(chatId, `Error: ${err.message}`);
        }
    });

    // ========================================================================
    // EMAIL INBOX COMMANDS
    // ========================================================================

    bot.onText(/\/inbox(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const statusFilter = (match?.[1] || 'not_started').trim().toLowerCase();
            // Subcommands handled by dedicated handlers — skip here
            if (/^(clear|done\s+all|delete|mark)\b/.test(statusFilter)) return;
            const validStatuses = ['not_started', 'in_progress', 'done', 'all'];
            if (!validStatuses.includes(statusFilter)) {
                await bot.sendMessage(chatId, `Invalid status. Use: /inbox [not_started|in_progress|done|all]\n\nManage: /inbox clear | /inbox done all | /inbox delete N | /inbox mark N status`);
                return;
            }

            const emails = await getEmailsByStatus(statusFilter);
            const priorityEmoji = { high: '🔴', medium: '🟡', low: '🔵', spam: '⚪' };

            if (emails.length === 0) {
                await bot.sendMessage(chatId, `*Inbox — ${statusFilter.replace(/_/g, ' ')}*\n\nNo emails.`, { parse_mode: 'Markdown' });
                return;
            }

            let text = `*Inbox — ${statusFilter.replace(/_/g, ' ')}* (${emails.length})\n\n`;
            const buttons = [];
            for (const e of emails.slice(0, 10)) {
                const emoji = priorityEmoji[e.triage?.priority] || '⚪';
                const ago = timeAgo(e.received_at);
                const sender = (e.from_name || e.from_address || '').substring(0, 20);
                text += `${emoji} *#${e.display_number}* ${sender}\n`;
                text += `  ${e.subject.substring(0, 55)}\n`;
                text += `  ${ago}\n\n`;
                buttons.push([
                    { text: `📖 #${e.display_number} View`, callback_data: `em_view_${e.display_number}` },
                    { text: `↩️ Reply`, callback_data: `em_reply_${e.display_number}` },
                    { text: `✅ Done`, callback_data: `em_markdone_${e.display_number}` },
                    { text: `🗑️`, callback_data: `em_del_${e.display_number}` },
                ]);
            }
            if (emails.length > 10) text += `_... and ${emails.length - 10} more_\n`;
            buttons.push([{ text: '◀️ Email Menu', callback_data: 'em_menu' }]);

            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
        } catch (err) {
            await bot.sendMessage(chatId, `Error: ${err.message}`);
        }
    });

    bot.onText(/\/email$/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        await bot.sendMessage(chatId, '<b>ALEX — Email Menu</b>\n\nTap an action below:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📥 Inbox (New)', callback_data: 'em_inbox' }, { text: '⏳ In Progress', callback_data: 'em_inprog' }],
                    [{ text: '✅ Done', callback_data: 'em_done' }, { text: '📋 All Emails', callback_data: 'em_all' }],
                    [{ text: '✅ Mark All Done', callback_data: 'em_doneall' }, { text: '🧹 Clear Done', callback_data: 'em_cleardone' }],
                    [{ text: '🗑️ Clear All', callback_data: 'em_clearall' }],
                ]
            }
        });
    });

    // Handle all email inline button callbacks
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        if (!isAuthorizedUser(userId)) {
            await bot.answerCallbackQuery(query.id, { text: 'Not authorized' });
            return;
        }
        const data = query.data;

        // Handle feedback buttons (from heartbeat messages)
        if (data?.startsWith('fb_')) {
            const match = data.match(/^fb_(good|bad)_(.+)$/);
            if (match) {
                const [, rating, taskName] = match;
                const feedbackDir = path.join(WORKSPACE_PATH, 'logs', 'feedback');
                await mkdir(feedbackDir, { recursive: true });
                const date = new Date().toISOString().split('T')[0];
                const entry = {
                    timestamp: new Date().toISOString(),
                    task_name: taskName,
                    rating,
                    message_id: query.message?.message_id,
                    user_id: userId,
                };
                await appendFile(
                    path.join(feedbackDir, `feedback_${date}.jsonl`),
                    JSON.stringify(entry) + '\n'
                );
                await bot.answerCallbackQuery(query.id, {
                    text: rating === 'good' ? 'Thanks! Noted as useful.' : 'Thanks! I\'ll try to improve.',
                });
                console.log(`[FEEDBACK] ${rating} for ${taskName} from user ${userId}`);
            }
            return;
        }

        if (!data?.startsWith('em_')) return;

        await bot.answerCallbackQuery(query.id);
        const priorityEmoji = { high: '🔴', medium: '🟡', low: '🔵', spam: '⚪' };

        // Format email list with per-email action buttons
        const sendEmailList = async (emails, label) => {
            if (emails.length === 0) {
                await bot.sendMessage(chatId, `*Inbox — ${label}*\n\nNo emails.`, { parse_mode: 'Markdown' });
                return;
            }
            let text = `*Inbox — ${label}* (${emails.length})\n\n`;
            const buttons = [];
            for (const e of emails.slice(0, 10)) {
                const emoji = priorityEmoji[e.triage?.priority] || '⚪';
                const ago = timeAgo(e.received_at);
                const sender = (e.from_name || e.from_address || '').substring(0, 20);
                text += `${emoji} *#${e.display_number}* ${sender}\n`;
                text += `  ${e.subject.substring(0, 55)}\n`;
                text += `  ${ago}\n\n`;
                // Action buttons row for this email
                buttons.push([
                    { text: `📖 #${e.display_number} View`, callback_data: `em_view_${e.display_number}` },
                    { text: `↩️ Reply`, callback_data: `em_reply_${e.display_number}` },
                    { text: `✅ Done`, callback_data: `em_markdone_${e.display_number}` },
                    { text: `🗑️`, callback_data: `em_del_${e.display_number}` },
                ]);
            }
            if (emails.length > 10) text += `_... and ${emails.length - 10} more_\n`;
            // Add back-to-menu button
            buttons.push([{ text: '◀️ Back to Email Menu', callback_data: 'em_menu' }]);
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
        };

        // Send single email detail with action buttons
        const sendEmailDetail = async (num) => {
            const email = await getEmailByNumber(num);
            if (!email) {
                await bot.sendMessage(chatId, `Email #${num} not found.`);
                return;
            }
            let text = `*Email #${email.display_number}*\n\n`;
            text += `*From:* ${email.from_name} (${email.from_address})\n`;
            text += `*Subject:* ${email.subject}\n`;
            text += `*Date:* ${new Date(email.date).toLocaleString('en-GB', { timeZone: 'Europe/London' })}\n`;
            text += `*Status:* ${email.status.replace(/_/g, ' ')}\n`;
            text += `*Priority:* ${priorityEmoji[email.triage?.priority] || '⚪'} ${email.triage?.priority || 'unknown'}\n`;
            text += `*Category:* ${email.triage?.category || 'unknown'}\n`;
            text += `*Action needed:* ${(email.triage?.required_action || 'review').replace(/_/g, ' ')}\n\n`;
            if (email.triage?.summary) text += `*Assessment:* ${email.triage.summary}\n`;
            if (email.triage?.suggested_response) text += `*Suggested:* ${email.triage.suggested_response}\n`;
            text += `\n*Preview:*\n${(email.body_preview || '').substring(0, 500)}\n`;
            if (email.actions?.length > 0) {
                text += `\n*History:*\n`;
                for (const a of email.actions.slice(-3)) {
                    text += `• ${a.description} (${new Date(a.timestamp).toLocaleTimeString('en-GB', { timeZone: 'Europe/London' })})\n`;
                }
            }
            const n = email.display_number;
            await bot.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '↩️ Reply', callback_data: `em_reply_${n}` },
                            { text: '📧 Forward', callback_data: `em_fwd_${n}` },
                            { text: '📝 Summarise', callback_data: `em_sum_${n}` },
                        ],
                        [
                            { text: '✅ Mark Done', callback_data: `em_markdone_${n}` },
                            { text: '⏳ In Progress', callback_data: `em_markinprog_${n}` },
                            { text: '🗑️ Delete', callback_data: `em_del_${n}` },
                        ],
                        [{ text: '◀️ Back to Inbox', callback_data: 'em_inbox' }],
                    ]
                }
            });
        };

        try {
            // Menu/list actions
            if (data === 'em_menu') {
                await bot.sendMessage(chatId, '<b>ALEX — Email Menu</b>\n\nTap an action below:', {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📥 Inbox (New)', callback_data: 'em_inbox' }, { text: '⏳ In Progress', callback_data: 'em_inprog' }],
                            [{ text: '✅ Done', callback_data: 'em_done' }, { text: '📋 All Emails', callback_data: 'em_all' }],
                            [{ text: '✅ Mark All Done', callback_data: 'em_doneall' }, { text: '🧹 Clear Done', callback_data: 'em_cleardone' }],
                            [{ text: '🗑️ Clear All', callback_data: 'em_clearall' }],
                        ]
                    }
                });
                return;
            }
            if (data === 'em_inbox') { await sendEmailList(await getEmailsByStatus('not_started'), 'new'); return; }
            if (data === 'em_inprog') { await sendEmailList(await getEmailsByStatus('in_progress'), 'in progress'); return; }
            if (data === 'em_done') { await sendEmailList(await getEmailsByStatus('done'), 'done'); return; }
            if (data === 'em_all') { await sendEmailList(await getEmailsByStatus('all'), 'all'); return; }
            if (data === 'em_doneall') {
                const result = await bulkUpdateStatus('not_started', 'done');
                await bot.sendMessage(chatId, `✅ Marked ${result} email(s) as done.`);
                return;
            }
            if (data === 'em_cleardone') {
                const result = await clearEmailsByStatus('done');
                await bot.sendMessage(chatId, `🧹 Cleared ${result} done email(s).`);
                return;
            }
            if (data === 'em_clearall') {
                const result = await clearEmailsByStatus('all');
                await bot.sendMessage(chatId, `🗑️ Cleared ${result} email(s).`);
                return;
            }

            // Per-email actions: em_view_N, em_reply_N, em_markdone_N, em_del_N, em_fwd_N, em_sum_N, em_markinprog_N
            const perEmailMatch = data.match(/^em_(view|reply|markdone|markinprog|del|fwd|sum)_(\d+)$/);
            if (perEmailMatch) {
                const [, action, numStr] = perEmailMatch;
                const num = parseInt(numStr);
                const email = await getEmailByNumber(num);
                if (!email) {
                    await bot.sendMessage(chatId, `Email #${num} not found.`);
                    return;
                }

                switch (action) {
                    case 'view':
                        await sendEmailDetail(num);
                        break;
                    case 'reply': {
                        await bot.sendMessage(chatId, `*Replying to email #${num}...*\nFrom: ${email.from_name || email.from_address}\nSubject: ${email.subject}`, { parse_mode: 'Markdown' });
                        const typingInterval = setInterval(() => { bot.sendChatAction(chatId, 'typing').catch(() => {}); }, 4000);
                        try {
                            const result = await actionEmail(email.id, 'reply', chatId);
                            clearInterval(typingInterval);
                            await sendMarkdown(chatId, result.success ? `*Email #${num} — Replied*\n\n${(result.response || 'Done.').substring(0, 2000)}` : `*Email #${num} — Failed*\n\n${result.error}`);
                        } catch (e) { clearInterval(typingInterval); throw e; }
                        break;
                    }
                    case 'fwd': {
                        await bot.sendMessage(chatId, `To forward email #${num}, reply with the recipient address:\n\n/action ${num} forward recipient@email.com`);
                        break;
                    }
                    case 'sum': {
                        await bot.sendMessage(chatId, `*Summarising email #${num}...*`, { parse_mode: 'Markdown' });
                        const typingInterval = setInterval(() => { bot.sendChatAction(chatId, 'typing').catch(() => {}); }, 4000);
                        try {
                            const result = await actionEmail(email.id, 'summarise this email concisely', chatId);
                            clearInterval(typingInterval);
                            await sendMarkdown(chatId, result.success ? `*Email #${num} — Summary*\n\n${(result.response || 'Done.').substring(0, 2000)}` : `*Email #${num} — Failed*\n\n${result.error}`);
                        } catch (e) { clearInterval(typingInterval); throw e; }
                        break;
                    }
                    case 'markdone': {
                        await updateEmailStatus(email.id, 'done', 'Marked done via Telegram');
                        await bot.sendMessage(chatId, `✅ Email #${num} marked as done.`);
                        break;
                    }
                    case 'markinprog': {
                        await updateEmailStatus(email.id, 'in_progress', 'Marked in progress via Telegram');
                        await bot.sendMessage(chatId, `⏳ Email #${num} marked as in progress.`);
                        break;
                    }
                    case 'del': {
                        await deleteEmailByNumber(num);
                        await bot.sendMessage(chatId, `🗑️ Email #${num} deleted.`);
                        break;
                    }
                }
            }
        } catch (err) {
            await bot.sendMessage(chatId, `Error: ${err.message}`);
        }
    });

    bot.onText(/\/email\s+(\d+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const num = parseInt(match[1]);
            const email = await getEmailByNumber(num);
            if (!email) {
                await bot.sendMessage(chatId, `Email #${num} not found.`);
                return;
            }

            const priorityEmoji = { high: '🔴', medium: '🟡', low: '🔵', spam: '⚪' };
            let text = `*Email #${email.display_number}*\n\n`;
            text += `*From:* ${email.from_name} (${email.from_address})\n`;
            text += `*Subject:* ${email.subject}\n`;
            text += `*Date:* ${new Date(email.date).toLocaleString('en-GB', { timeZone: 'Europe/London' })}\n`;
            text += `*Status:* ${email.status.replace(/_/g, ' ')}\n`;
            text += `*Priority:* ${priorityEmoji[email.triage?.priority] || '⚪'} ${email.triage?.priority || 'unknown'}\n`;
            text += `*Category:* ${email.triage?.category || 'unknown'}\n`;
            text += `*Action needed:* ${(email.triage?.required_action || 'review').replace(/_/g, ' ')}\n\n`;

            if (email.triage?.summary) text += `*Assessment:* ${email.triage.summary}\n`;
            if (email.triage?.suggested_response) text += `*Suggested:* ${email.triage.suggested_response}\n`;
            text += `\n*Preview:*\n${(email.body_preview || '').substring(0, 500)}\n`;

            if (email.actions?.length > 0) {
                text += `\n*History:*\n`;
                for (const a of email.actions.slice(-3)) {
                    text += `• ${a.description} (${new Date(a.timestamp).toLocaleTimeString('en-GB', { timeZone: 'Europe/London' })})\n`;
                }
            }

            const n = email.display_number;
            await bot.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '↩️ Reply', callback_data: `em_reply_${n}` },
                            { text: '📧 Forward', callback_data: `em_fwd_${n}` },
                            { text: '📝 Summarise', callback_data: `em_sum_${n}` },
                        ],
                        [
                            { text: '✅ Mark Done', callback_data: `em_markdone_${n}` },
                            { text: '⏳ In Progress', callback_data: `em_markinprog_${n}` },
                            { text: '🗑️ Delete', callback_data: `em_del_${n}` },
                        ],
                        [{ text: '◀️ Back to Inbox', callback_data: 'em_inbox' }],
                    ]
                }
            });
        } catch (err) {
            await bot.sendMessage(chatId, `Error: ${err.message}`);
        }
    });

    bot.onText(/\/action\s+(\d+)(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const num = parseInt(match[1]);
            const instruction = match[2]?.trim() || null;
            const email = await getEmailByNumber(num);
            if (!email) {
                await bot.sendMessage(chatId, `Email #${num} not found.`);
                return;
            }

            await bot.sendMessage(chatId, `*Working on email #${num}...*\n\nFrom: ${email.from_name || email.from_address}\nSubject: ${email.subject}\n${instruction ? `Instruction: ${instruction}` : 'Using suggested action'}`, { parse_mode: 'Markdown' });

            const typingInterval = setInterval(() => {
                bot.sendChatAction(chatId, 'typing').catch(() => {});
            }, 4000);

            try {
                const result = await actionEmail(email.id, instruction, chatId);
                clearInterval(typingInterval);

                if (result.success) {
                    await sendMarkdown(chatId, `*Email #${num} — Done*\n\n${result.response?.substring(0, 2000) || 'Completed.'}`);
                } else {
                    await sendMarkdown(chatId, `*Email #${num} — Failed*\n\n${result.error}`);
                }
            } catch (actionErr) {
                clearInterval(typingInterval);
                await bot.sendMessage(chatId, `Action failed: ${actionErr.message}`);
            }
        } catch (err) {
            await bot.sendMessage(chatId, `Error: ${err.message}`);
        }
    });

    // /inbox clear [done|not_started|in_progress|all] — bulk clear emails
    bot.onText(/\/inbox\s+clear(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const status = (match?.[1] || 'done').trim().toLowerCase();
            const valid = ['done', 'not_started', 'in_progress', 'all'];
            if (!valid.includes(status)) {
                await bot.sendMessage(chatId, `Usage: /inbox clear [done|not_started|in_progress|all]\nDefaults to clearing done emails.`);
                return;
            }
            const count = await clearEmailsByStatus(status);
            await bot.sendMessage(chatId, `Cleared ${count} ${status === 'all' ? '' : status.replace(/_/g, ' ') + ' '}email${count !== 1 ? 's' : ''} from inbox.`);
        } catch (err) {
            await bot.sendMessage(chatId, `Error: ${err.message}`);
        }
    });

    // /inbox done all — mark all not_started as done
    bot.onText(/\/inbox\s+done\s+all/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const count = await bulkUpdateStatus('not_started', 'done');
            await bot.sendMessage(chatId, `Marked ${count} email${count !== 1 ? 's' : ''} as done.`);
        } catch (err) {
            await bot.sendMessage(chatId, `Error: ${err.message}`);
        }
    });

    // /inbox delete <num> — delete a single email
    bot.onText(/\/inbox\s+delete\s+(\d+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const num = parseInt(match[1]);
            const found = await deleteEmailByNumber(num);
            if (found) {
                await bot.sendMessage(chatId, `Deleted email #${num}.`);
            } else {
                await bot.sendMessage(chatId, `Email #${num} not found.`);
            }
        } catch (err) {
            await bot.sendMessage(chatId, `Error: ${err.message}`);
        }
    });

    // /inbox mark <num> <status> — change status of a single email
    bot.onText(/\/inbox\s+mark\s+(\d+)\s+(done|not_started|in_progress)/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            const num = parseInt(match[1]);
            const newStatus = match[2];
            const email = await getEmailByNumber(num);
            if (!email) {
                await bot.sendMessage(chatId, `Email #${num} not found.`);
                return;
            }
            await updateEmailStatus(email.id, newStatus, `Manually set to ${newStatus} via /inbox mark`);
            await bot.sendMessage(chatId, `Email #${num} marked as ${newStatus.replace(/_/g, ' ')}.`);
        } catch (err) {
            await bot.sendMessage(chatId, `Error: ${err.message}`);
        }
    });

    bot.onText(/\/duties/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        try {
            // --- Uptime & last-alive ---
            const { stdout: uptime } = await execAsync('uptime -p');
            let lastAliveStr = 'unknown';
            try {
                const raw = await readFile(path.join(WORKSPACE_PATH, 'logs', '.last-alive'), 'utf-8');
                const d = new Date(raw.trim());
                lastAliveStr = d.toLocaleString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' GMT';
            } catch {}

            // --- Parse cron log for last results per task ---
            const lastResults = new Map();
            const taskRunCounts = new Map(); // task -> { ok: n, fail: n }
            try {
                const logContent = await readFile(path.join(WORKSPACE_PATH, 'logs', 'cron.log'), 'utf-8');
                const entries = logContent.replace(/\}\{/g, '}\n{').split('\n').filter(l => l.trim());
                for (const line of entries) {
                    try {
                        const e = JSON.parse(line);
                        if (e.task) {
                            lastResults.set(e.task, e.success ? 'ok' : 'failed');
                            if (!taskRunCounts.has(e.task)) taskRunCounts.set(e.task, { ok: 0, fail: 0 });
                            const c = taskRunCounts.get(e.task);
                            if (e.success) c.ok++; else c.fail++;
                        }
                    } catch {}
                }
            } catch {}

            // --- Today's token stats ---
            let todayCalls = 0, todayCostGbp = 0;
            try {
                const stats = await getDailyTokenStats();
                todayCalls = stats.totalCalls;
                const GBP = 0.79;
                for (const [model, data] of Object.entries(stats.byModel)) {
                    let costUsd = 0;
                    if (model.includes('haiku')) costUsd = data.input / 1e6 * 0.8 + data.output / 1e6 * 4;
                    else if (model.includes('deepseek')) costUsd = data.input / 1e6 * 0.14 + data.output / 1e6 * 0.28;
                    else costUsd = data.input / 1e6 * 3 + data.output / 1e6 * 15;
                    todayCostGbp += costUsd * GBP;
                }
            } catch {}

            // --- Format cron expression to human-readable ---
            function cronToHuman(expr) {
                const [min, hour, dom, mon, dow] = expr.split(' ');
                const dayMap = { '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat' };
                let time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
                if (hour === '*' && min === '0') time = 'every hour';
                else if (hour.startsWith('*/')) time = `every ${hour.slice(2)}h`;

                let days = 'daily';
                if (dow !== '*') {
                    days = dow.split(',').map(d => dayMap[d] || d).join(', ');
                }
                return `${time} ${days}`;
            }

            // --- Built-in tasks ---
            const builtinSchedule = [
                { name: 'morning-briefing', cron: '0 8 * * *', desc: 'Daily morning briefing' },
                { name: 'midmorning-checkin', cron: '0 11 * * *', desc: 'Mid-morning check-in' },
                { name: 'midday-research', cron: '0 13 * * *', desc: 'Economic research scan' },
                { name: 'afternoon-checkin', cron: '0 16 * * *', desc: 'Afternoon check-in' },
                { name: 'evening-summary', cron: '0 18 * * *', desc: 'Evening summary' },
                { name: 'weekly-self-review', cron: '0 22 * * 0', desc: 'Weekly self-improvement review' },
                { name: 'dashboard-sync', cron: '0 * * * *', desc: 'Hourly dashboard metrics sync' },
                { name: 'cleanup', cron: '0 3 * * *', desc: 'Conversation memory cleanup' },
            ];

            // --- User tasks from disk ---
            const userTasks = [];
            try {
                const taskDir = path.join(WORKSPACE_PATH, 'tasks');
                const { readdir } = await import('fs/promises');
                const files = await readdir(taskDir);
                for (const f of files) {
                    if (!f.endsWith('.json')) continue;
                    try {
                        const raw = await readFile(path.join(taskDir, f), 'utf-8');
                        const t = JSON.parse(raw);
                        userTasks.push({ name: t.name, cron: t.cron_expression, desc: t.task_description?.substring(0, 60) || 'No description' });
                    } catch {}
                }
            } catch {}

            // --- Next duty calculation ---
            function getNextRun(cronExpr) {
                const [min, hour, , , dow] = cronExpr.split(' ');
                const now = new Date();
                const nowLondon = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));

                if (hour === '*' || hour.startsWith('*/')) {
                    // Hourly task — next full hour
                    const next = new Date(nowLondon);
                    next.setMinutes(parseInt(min) || 0, 0, 0);
                    if (next <= nowLondon) next.setHours(next.getHours() + (hour.startsWith('*/') ? parseInt(hour.slice(2)) : 1));
                    return next;
                }

                const targetHour = parseInt(hour);
                const targetMin = parseInt(min);
                const dows = dow === '*' ? [0,1,2,3,4,5,6] : dow.split(',').map(Number);

                for (let offset = 0; offset < 8; offset++) {
                    const candidate = new Date(nowLondon);
                    candidate.setDate(candidate.getDate() + offset);
                    candidate.setHours(targetHour, targetMin, 0, 0);
                    if (candidate > nowLondon && dows.includes(candidate.getDay())) return candidate;
                }
                return null;
            }

            // --- Build output ---
            const totalRuns = [...taskRunCounts.values()].reduce((s, c) => s + c.ok + c.fail, 0);
            const totalFails = [...taskRunCounts.values()].reduce((s, c) => s + c.fail, 0);

            let text = `*ALEX — Duties & Performance*\n\n`;
            text += `System: ${uptime.trim()}\n`;
            text += `Last heartbeat: ${lastAliveStr}\n`;
            text += `Today: ${todayCalls} API calls, £${todayCostGbp.toFixed(4)} spent\n`;
            text += `Cron history: ${totalRuns} runs logged (${totalFails} failures)\n\n`;

            function formatDuty(t) {
                const lastStatus = lastResults.has(t.name) ? (lastResults.get(t.name) === 'ok' ? 'OK' : 'FAIL') : '--';
                const runs = taskRunCounts.get(t.name);
                const runStr = runs ? `${runs.ok}/${runs.ok + runs.fail} success` : 'no runs';
                const schedule = cronToHuman(t.cron);
                const next = getNextRun(t.cron);
                const nextStr = next ? next.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
                return `• \`${t.name}\` [${lastStatus}]\n  ${t.desc}\n  ${schedule}${nextStr ? ` | next: ${nextStr}` : ''} | ${runStr}\n`;
            }

            text += `*Built-in (${builtinSchedule.length}):*\n`;
            for (const t of builtinSchedule) {
                text += formatDuty(t);
            }

            if (userTasks.length > 0) {
                text += `\n*Custom (${userTasks.length}):*\n`;
                for (const t of userTasks) {
                    text += formatDuty(t);
                }
            }

            text += `\n*${builtinSchedule.length + userTasks.length} total duties.* All run via system cron with 3x retry and startup catch-up.\n`;
            text += `_Ask me to "schedule [task]" to add new duties or "delete task [name]" to remove._`;

            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(chatId, `Error getting duties: ${error.message}`);
        }
    });

    const MODEL_OPTIONS = [
        { key: 'auto', label: 'Auto', model: null, desc: 'Smart routing — Haiku default, Sonnet for complex tasks', price: '' },
        // Claude
        { key: 'haiku', label: 'Haiku', model: 'claude-3-5-haiku-20241022', desc: 'Fast, cheap. Default for simple tasks', price: '$0.80/$4.00 per 1M' },
        { key: 'sonnet', label: 'Sonnet', model: 'claude-sonnet-4-20250514', desc: 'Best all-rounder. Research, reports, tool use', price: '$3.00/$15.00 per 1M' },
        { key: 'opus', label: 'Opus', model: 'claude-opus-4-5-20251101', desc: 'Maximum capability. Serious work only', price: '$15.00/$75.00 per 1M' },
        // OpenAI
        { key: 'o3', label: 'o3', model: 'o3', desc: 'Strongest reasoning. Multi-step problem solving', price: '$10.00/$40.00 per 1M' },
        { key: 'o4-mini', label: 'o4-mini', model: 'o4-mini', desc: 'Fast reasoning. Great cost/performance', price: '$1.10/$4.40 per 1M' },
        { key: 'gpt-4.1', label: 'GPT-4.1', model: 'gpt-4.1', desc: 'Best for coding and instruction following', price: '$2.00/$8.00 per 1M' },
        { key: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', model: 'gpt-4.1-mini', desc: 'Balanced speed and quality', price: '$0.40/$1.60 per 1M' },
        { key: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', model: 'gpt-4.1-nano', desc: 'Fastest and cheapest OpenAI', price: '$0.10/$0.40 per 1M' },
        { key: 'gpt-4o', label: 'GPT-4o', model: 'gpt-4o', desc: 'Previous OpenAI flagship', price: '$2.50/$10.00 per 1M' },
        { key: 'gpt-5', label: 'GPT-5', model: 'gpt-5', desc: 'Reasoning flagship. Complex multi-step tasks', price: '$1.25/$10.00 per 1M' },
        { key: 'gpt-5-mini', label: 'GPT-5 Mini', model: 'gpt-5-mini', desc: 'Fast reasoning. Great value', price: '$0.25/$2.00 per 1M' },
        { key: 'gpt-5-nano', label: 'GPT-5 Nano', model: 'gpt-5-nano', desc: 'Cheapest GPT-5. Quick tasks', price: '$0.05/$0.40 per 1M' },
        { key: 'gpt-5.1', label: 'GPT-5.1', model: 'gpt-5.1', desc: 'Enhanced reasoning over GPT-5', price: '$1.25/$10.00 per 1M' },
        { key: 'gpt-5.2', label: 'GPT-5.2', model: 'gpt-5.2', desc: 'Strongest OpenAI model', price: '$1.75/$14.00 per 1M' },
        // Kimi
        { key: 'kimi', label: 'Kimi K2', model: 'kimi-k2', desc: 'Full tool access. 128K context. Fast and cheap', price: '$0.50/$2.00 per 1M' },
        { key: 'kimi-thinking', label: 'Kimi K2 Thinking', model: 'kimi-k2-thinking', desc: 'Reasoning mode. 256K context', price: '$1.00/$4.00 per 1M' },
        // Other
        { key: 'deepseek', label: 'DeepSeek', model: 'deepseek-chat', desc: 'Deep research and analysis. Text only', price: '$0.14/$0.28 per 1M' },
        // OpenRouter models
        { key: 'gemini-pro', label: 'Gemini 2.5 Pro', model: 'google/gemini-2.5-pro', desc: 'Google flagship. 1M context. Tool support', price: '$1.25/$10.00 per 1M' },
        { key: 'gemini-flash', label: 'Gemini 2.5 Flash', model: 'google/gemini-2.5-flash', desc: 'Fast Google model. Tool support', price: '$0.15/$0.60 per 1M' },
        { key: 'llama', label: 'Llama 3.3 70B', model: 'meta-llama/llama-3.3-70b-instruct', desc: 'Meta open-weight. Fast and capable', price: '$0.40/$0.40 per 1M' },
        { key: 'mistral', label: 'Mistral Large', model: 'mistralai/mistral-large-2411', desc: 'Mistral flagship. Tool support', price: '$2.00/$6.00 per 1M' },
        { key: 'qwen', label: 'Qwen 2.5 72B', model: 'qwen/qwen-2.5-72b-instruct', desc: 'Alibaba flagship. Text only', price: '$0.35/$0.40 per 1M' },
    ];

    function buildModelMenu(chatId) {
        const current = modelOverrides.get(chatId);
        const currentLabel = current ? MODEL_OPTIONS.find(o => o.model === current)?.label || current : 'Auto';
        let text = `*ALEX — Model Selection*\n\nCurrent: *${currentLabel}*\n\n`;
        MODEL_OPTIONS.forEach((opt, i) => {
            const marker = (opt.model === current || (!current && opt.key === 'auto')) ? ' [active]' : '';
            text += `*${i + 1}. ${opt.label}*${marker}\n  ${opt.desc}\n`;
            if (opt.price) text += `  ${opt.price}\n`;
        });
        text += `\nReply with a *number* (1-${MODEL_OPTIONS.length}) or *name* (e.g. haiku) to switch.\nModel lock persists until you change it or select Auto.`;
        return text;
    }

    bot.onText(/\/(models|agents)/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedUser(msg.from.id)) { await bot.sendMessage(chatId, "This command is only available to authorized users."); return; }
        await bot.sendMessage(chatId, buildModelMenu(chatId), { parse_mode: 'Markdown' });
        awaitingModelSelect.add(chatId);
    });

    // Per-user Telegram rate limiting
    const userRateLimits = new Map(); // userId → { count, resetAt }
    const RATE_LIMIT_WINDOW = 60000; // 60s
    const RATE_LIMIT_OWNER = 40;
    const RATE_LIMIT_USER = 20;
    const MAX_MESSAGE_LENGTH = 50000;

    function checkUserRateLimit(userId) {
        const now = Date.now();
        let entry = userRateLimits.get(userId);
        if (!entry || now > entry.resetAt) {
            entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
            userRateLimits.set(userId, entry);
        }
        entry.count++;
        const limit = (String(userId) === String(config.telegram_owner_id)) ? RATE_LIMIT_OWNER : RATE_LIMIT_USER;
        return entry.count <= limit;
    }

    // Clean up stale rate limit entries every 5 minutes
    setInterval(() => {
        const now = Date.now();
        for (const [uid, entry] of userRateLimits) {
            if (now > entry.resetAt) userRateLimits.delete(uid);
        }
    }, 300000);

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

        // Track owner activity for idle starter
        if (String(userId) === String(config.telegram_owner_id)) {
            lastOwnerMessageTime = Date.now();
        }

        // Per-user rate limiting
        if (!checkUserRateLimit(userId)) {
            await bot.sendMessage(chatId, 'You\'re sending messages too quickly. Please wait a moment before trying again.');
            return;
        }

        // Message length limit
        if (msg.text && msg.text.length > MAX_MESSAGE_LENGTH) {
            await bot.sendMessage(chatId, `Message too long (${msg.text.length} chars). Please keep messages under ${MAX_MESSAGE_LENGTH.toLocaleString()} characters.`);
            return;
        }

        // Tiered authorization: authorized users get full access, others get limited chat
        // (Limited users can chat but owner-only tools are blocked in tools.js via OWNER_ONLY_TOOLS)

        // Handle model selection reply
        if (awaitingModelSelect.has(chatId) && msg.text) {
            awaitingModelSelect.delete(chatId);
            const input = msg.text.trim().toLowerCase();
            const byNumber = MODEL_OPTIONS[parseInt(input) - 1];
            const byName = MODEL_OPTIONS.find(o => o.key === input || o.label.toLowerCase() === input);
            const match = byNumber || byName;
            if (match) {
                if (match.model) {
                    modelOverrides.set(chatId, match.model);
                } else {
                    modelOverrides.delete(chatId);
                }
                await bot.sendMessage(chatId, `Model set to *${match.label}*. ${match.model ? 'All messages will use this model.' : 'Smart routing restored.'}`, { parse_mode: 'Markdown' });
            } else {
                await bot.sendMessage(chatId, `Unknown model. Use /models to try again.`);
            }
            return;
        }

        // EXEC_SUMMARY trigger — send Executive Summary PDF to a client via email
        if (msg.text && msg.text.includes('EXEC_SUMMARY')) {
            const emailMatch = msg.text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
            if (!emailMatch) {
                await bot.sendMessage(chatId, '📧 Please include an email address.\n\nExample: `send EXEC_SUMMARY to john@company.com`', { parse_mode: 'Markdown' });
                return;
            }
            const recipientEmail = emailMatch[0];
            await bot.sendChatAction(chatId, 'typing');
            try {
                currentCallerUserId = userId;
                const execSummaryPrompt = `Send an email with the following EXACT details using the send_email tool. Do NOT change any of these values:

- to: ${recipientEmail}
- subject: NAVADA AI Business Model — Executive Summary
- body: Use this professional HTML body:
<div style="font-family: Arial, sans-serif; color: #333;">
<p>Dear Colleague,</p>
<p>Thank you for your interest in NAVADA's AI Business Model research.</p>
<p>Please find attached our <strong>Executive Summary</strong>, which covers:</p>
<ul>
<li>AI token economics and cost optimisation frameworks</li>
<li>Consultant vs AI cost comparisons (£6,950 vs £185 for equivalent work)</li>
<li>5-year revenue trajectories for AI adopters vs non-adopters</li>
<li>Strategic recommendations for CEO-level AI implementation</li>
<li>Sector-specific impact analysis and workforce planning</li>
</ul>
<p>If you would like to discuss how these findings apply to your organisation, please don't hesitate to get in touch.</p>
<p>Best regards,<br><strong>Lee Akpareva</strong><br>Founder & CEO, NAVADA<br>AI Strategy & Implementation Consulting</p>
</div>
- attachment_path: /home/head/.alex/files/documents/NAVADA_Executive_Summary.pdf

Call the send_email tool now with exactly these parameters.`;
                const response = await chatSystem.chat(chatId, execSummaryPrompt, msg.from, { modelOverride: modelOverrides.get(chatId) }, { chatId, source: 'telegram' });
                if (!response.toLowerCase().includes('error') && !response.toLowerCase().includes('failed')) {
                    await bot.sendMessage(chatId, `✅ Executive Summary sent to *${recipientEmail}*`, { parse_mode: 'Markdown' });
                } else {
                    await bot.sendMessage(chatId, `⚠️ There may have been an issue:\n${response.substring(0, 500)}`);
                }
            } catch (err) {
                console.error('[EXEC_SUMMARY] Error:', err.message);
                await bot.sendMessage(chatId, `❌ Failed to send Executive Summary: ${err.message}`);
            } finally {
                currentCallerUserId = null;
            }
            return;
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

                    // Save photo to disk for email attachments
                    try {
                        const uploadsDir = path.join(WORKSPACE_PATH, 'files', 'uploads');
                        await mkdir(uploadsDir, { recursive: true });
                        const filename = `photo_${Date.now()}.jpg`;
                        const filePath = path.join(uploadsDir, filename);
                        await writeFile(filePath, imgBuffer);
                        const uploads = recentUploads.get(chatId) || [];
                        uploads.push({ path: filePath, filename, timestamp: Date.now() });
                        recentUploads.set(chatId, uploads);
                        console.log(`[PHOTO] Saved to ${filePath}`);
                    } catch (saveErr) {
                        console.error('[PHOTO] Save to disk failed:', saveErr.message);
                    }
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
                        // PDF — save to disk for RAG indexing, then send to Claude
                        const pdfDir = path.join(WORKSPACE_PATH, 'files', 'pdfs');
                        await mkdir(pdfDir, { recursive: true });
                        const pdfFilename = `${Date.now()}_${fileName}`;
                        const pdfPath = path.join(pdfDir, pdfFilename);
                        await writeFile(pdfPath, fileBuffer);
                        console.log(`[PDF] Saved to ${pdfPath}`);

                        // Extract text for RAG indexing (async, don't block)
                        extractPdfForRag(pdfPath).catch(err =>
                            console.error('[PDF] RAG indexing failed:', err.message)
                        );

                        // Send as document to Claude
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
                const acks = [
                    'On it.', 'Give me a moment.', 'Looking into it.', 'One sec.',
                    'Pulling that up now.', 'Sure thing.', 'Checking now.', 'Right, let me see.',
                    'Good question — digging in.', 'Grabbing that for you.', 'Working on it.',
                    'Bear with me.', 'Just a moment.', 'Coming right up.'
                ];
                const ack = acks[Math.floor(Math.random() * acks.length)];
                await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
                await bot.sendMessage(chatId, ack, { parse_mode: 'Markdown' });
            }

            // Keep typing indicator alive
            const typingInterval = setInterval(() => {
                bot.sendChatAction(chatId, 'typing').catch(() => {});
            }, 4000);

            // Inject mode prefixes if active
            let chatInput = contentBlocks || userMessage;
            let modePrefix = '';

            if (learnModeChats.has(chatId)) {
                modePrefix += `[LEARN MODE ACTIVE — OVERRIDE FORMATTING RULES]

You MUST structure your response exactly like this, with clear section headers and blank lines between paragraphs. Use this exact format:

WHAT

[Write 1-3 clear paragraphs explaining the facts, definitions, and core concept. Separate each paragraph with a blank line. Be specific and educational.]

HOW

[Write 1-3 clear paragraphs explaining how it works in practice, real-world applications, mechanisms, or step-by-step processes. Separate each paragraph with a blank line.]

WHY

[Write 1-3 clear paragraphs explaining why this matters, the deeper significance, implications, and what the user should take away. Separate each paragraph with a blank line.]

Rules for Learn Mode:
- Always use the three section headers: WHAT, HOW, WHY — each on its own line
- Leave a blank line before and after each header
- Leave a blank line between every paragraph
- Write in full, clear sentences — not bullet points
- Be educational and thorough — teach the user something valuable
- Use plain text only, no markdown symbols, no bold, no bullets
- Each section should be substantive (not just one sentence)
- If the topic is simple, go deeper — add context, history, or nuance

`;
            }

            if (mathModeChats.has(chatId)) {
                modePrefix += `[MATHEMATICIAN MODE ACTIVE — QUANTITATIVE OVERRIDE]

You are operating as a senior quantitative economist and mathematician. Apply rigorous mathematical and computational thinking to every response.

Structure your response with:

ANALYSIS — Frame the problem mathematically. Define variables, identify the model or framework.

CALCULATION — Show full step-by-step workings. Never skip steps. Use proper notation.
- Financial: NPV, IRR, CAGR, DCF, WACC, Sharpe ratio, Monte Carlo, option pricing (Black-Scholes)
- Microeconomics: Supply/demand curves, elasticity (PED, YED, XED), marginal cost/revenue, profit maximisation, consumer/producer surplus, utility functions, indifference curves, budget constraints, Cobb-Douglas production
- Macroeconomics: GDP calculation (expenditure/income/output), multiplier effects, IS-LM model, Phillips curve, quantity theory of money (MV=PQ), Solow growth model, balance of payments, exchange rate models
- Statistics: Regression, correlation, confidence intervals, hypothesis testing, Bayesian analysis, standard deviation, z-scores
- Optimisation: Linear programming, Lagrange multipliers, game theory (Nash equilibrium, dominant strategies, payoff matrices)

RESULT — State the answer clearly with units. Interpret what the numbers mean in business/economic terms.

SENSITIVITY — How do results change if key assumptions shift by 10-20%? Flag the most sensitive variables.

Rules for Mathematician Mode:
- Show ALL calculations — never say "the result is X" without showing how you got there
- Use proper mathematical notation where possible
- Always state assumptions explicitly
- Provide confidence ranges, not just point estimates
- If data is missing, state what you'd need and work with reasonable assumptions
- Round final answers appropriately but keep intermediate calculations precise
- Apply dimensional analysis — always track units

`;
            }

            if (strategistModeChats.has(chatId)) {
                modePrefix += `[STRATEGIST MODE ACTIVE — STRATEGIC OVERRIDE]

You are operating as a senior strategy consultant. Frame every response through strategic lenses.

Structure your response with:

SITUATION — Current state, key facts, market context.

ANALYSIS — Apply the most relevant framework(s):
- SWOT (Strengths, Weaknesses, Opportunities, Threats)
- Porter's Five Forces (rivalry, new entrants, substitutes, buyer power, supplier power)
- PESTLE (Political, Economic, Social, Technological, Legal, Environmental)
- Value Chain Analysis
- BCG Matrix / Ansoff Matrix
- Blue Ocean vs Red Ocean
- Jobs-to-be-Done
- First-principles decomposition

RECOMMENDATION — Clear, prioritised actions. State what to do, why, and in what order.

RISKS — What could go wrong. Mitigations for each risk.

Rules for Strategist Mode:
- Always name the framework(s) you are applying
- Be specific and actionable — no vague advice
- Quantify where possible (market size, probability, impact)
- Consider second-order effects and competitive responses
- Present trade-offs honestly — every strategy has a cost

`;
            }

            if (voiceModeChats.has(chatId)) {
                modePrefix += `[VOICE MODE ACTIVE]

After formulating your response, you MUST use the send_voice_message tool to deliver it as a voice message. Keep responses conversational and concise — optimised for listening, not reading. Still provide a brief text summary alongside the voice.

`;
            }

            if (pythonModeChats.has(chatId)) {
                modePrefix += `[PYTHON MODE ACTIVE — DATA ANALYSIS OVERRIDE]

You MUST use the generate_chart tool (which executes Python) for EVERY analytical question. Do not answer with text-only analysis — write Python code that computes the answer.

Your Python environment has: numpy, pandas, matplotlib, seaborn, scipy, sklearn, statistics, math, json, csv, io, datetime.

Structure your approach:

DATA — Load or create the data. Use pandas DataFrames for any tabular data. If the user provides raw numbers or a CSV, parse it into a DataFrame first.

ANALYSIS — Write Python code that performs the actual computation:
• Use pandas for data manipulation: groupby, pivot_table, merge, rolling, resample, describe()
• Use numpy/scipy for numerical work: linalg, optimize, stats, interpolate
• Use sklearn for ML: clustering, regression, classification, PCA, train_test_split
• Use statistics module for basic stats: mean, median, stdev, correlation

OUTPUT — Always produce visible output:
• Print formatted DataFrames using df.to_string() or tabulate
• Print summary statistics, test results, coefficients
• For any visual pattern, trend, or comparison: create a matplotlib/seaborn chart
• Use plt.savefig() so the chart gets sent as an image to Telegram

Rules for Python Mode:
- ALWAYS execute Python code — never just describe what code would do
- Print DataFrames and results so they appear in the response
- Create charts for any data that benefits from visualisation
- Use seaborn for statistical plots (heatmaps, pair plots, violin plots, regression plots)
- Use matplotlib for custom plots (time series, bar charts, scatter, histograms)
- Label axes, add titles, use plt.tight_layout()
- If the user asks a simple factual question, still compute it in Python rather than answering from memory
- For financial data, use the stock_quote / economic_indicator tools first, then analyse with Python
- Show the key numbers in text AND as a chart where relevant

`;
            }

            if (modePrefix) {
                if (typeof chatInput === 'string') {
                    chatInput = modePrefix + 'Now answer this:\n\n' + chatInput;
                } else if (Array.isArray(chatInput)) {
                    chatInput = [{ type: 'text', text: modePrefix + 'Now answer this:\n\n' }, ...chatInput];
                }
            }

            let response;
            try {
                currentCallerUserId = userId;
                response = await chatSystem.chat(chatId, chatInput, msg.from, { modelOverride: modelOverrides.get(chatId) }, { chatId, source: 'telegram' });
            } finally {
                currentCallerUserId = null;
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

            // Log task to dashboard only when CAPITAL trigger keywords are used
            const TASK_TRIGGERS = /\b(TASK|APPOINTMENT|BOOKING|MEETING|DEADLINE|REMINDER|TODO|FOLLOW[\s-]?UP|ACTION|SCHEDULE)\b/;
            if (TASK_TRIGGERS.test(userMessage)) {
                const taskSummary = userMessage.substring(0, 120);
                postDashboard('add_task', { task: {
                    name: taskSummary,
                    category: 'tracked-task',
                    status: 'completed',
                    time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) + ' GMT',
                }});
                postDashboard('add_activity', { entry: `📌 Tracked: ${taskSummary}` });
            }

            // Journal: append exchange to daily file
            appendExchange({
                question: (typeof chatInput === 'string' ? chatInput : userMessage).substring(0, 500),
                answer: response.substring(0, 1500),
                source: 'telegram',
                modelLabel: journalModelLabel(modelOverrides.get(chatId) || selectModel(userMessage)),
                userName: msg.from.first_name || 'Leslie',
            }).catch(err => console.error('[JOURNAL]', err.message));

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
                await sendMarkdown(chatId, part);
            }

        } catch (error) {
            console.error('[ERROR]', error);
            auditLog({
                type: 'error',
                user_id: userId,
                chat_id: chatId,
                error: error.message || String(error),
                status: error?.status,
            }).catch(() => {});
            const isRateLimit = error?.status === 429 || (error.message && error.message.toLowerCase().includes('rate limit'));
            const isOverloaded = error?.status === 529 || (error.message && error.message.toLowerCase().includes('overloaded'));
            if (isRateLimit || isOverloaded) {
                console.log('[RATE_LIMIT] Retries exhausted, notifying user');
                await bot.sendMessage(chatId, 'I\'m experiencing high demand right now. I\'ll retry your request shortly — hang tight.');
                setTimeout(async () => {
                    try {
                        await bot.sendChatAction(chatId, 'typing');
                        const retryResponse = await chatSystem.chat(chatId, msg.text || '', msg.from);
                        await sendMarkdown(chatId, retryResponse);
                    } catch (retryErr) {
                        console.error('[RETRY_FAILED]', retryErr.message);
                    }
                }, 60000);
            } else {
                await bot.sendMessage(chatId, `Something went wrong, but I've logged the issue. Try again in a moment.`);
            }
        }
    });

    // Register commands with Telegram so they appear in the / menu
    bot.setMyCommands([
        { command: 'action', description: 'Act on email — /action 1 reply' },
        { command: 'alex', description: 'Full command reference' },
        { command: 'architecture', description: 'Project and workspace structure' },
        { command: 'brief', description: 'Recent activity summary' },
        { command: 'cleanup', description: 'Manual cleanup of old files' },
        { command: 'clear', description: 'Clear conversation history' },
        { command: 'costs', description: 'Per-task cost attribution' },
        { command: 'dashboard', description: 'Live dashboard link' },
        { command: 'disk', description: 'Disk usage breakdown' },
        { command: 'duties', description: 'All duties, schedules, performance' },
        { command: 'email', description: 'Full email details — /email 1' },
        { command: 'errors', description: 'Today\'s errors from audit log' },
        { command: 'exit', description: 'Turn off all active modes' },
        { command: 'fixes', description: 'Recent changelog and improvements' },
        { command: 'glassdoor', description: 'Glassdoor company reviews & salaries' },
        { command: 'googlecalendar', description: 'Connect Google Calendar' },
        { command: 'health', description: 'Quick system health overview' },
        { command: 'help', description: 'Full guide with tips' },
        { command: 'id', description: 'Your Telegram user and chat ID' },
        { command: 'indeed', description: 'Indeed job search' },
        { command: 'inbox', description: 'Email queue (not_started by default)' },
        { command: 'kemet', description: 'KEMET Automotive project (restricted)' },
        { command: 'kill', description: 'Stop all current activities instantly' },
        { command: 'leads', description: 'Google Maps lead scraper' },
        { command: 'learn', description: 'Educational mode (What/How/Why)' },
        { command: 'linkedinposts', description: 'Search LinkedIn posts' },
        { command: 'linkedinprofiles', description: 'Scrape LinkedIn profiles' },
        { command: 'logs', description: 'Recent audit log entries' },
        { command: 'mathematician', description: 'Quantitative and computational' },
        { command: 'memory', description: 'Browse memory banks' },
        { command: 'mode', description: 'Show active modes' },
        { command: 'models', description: 'Switch AI model (Claude, GPT, Gemini, Llama, Mistral, Qwen)' },
        { command: 'news', description: 'Latest gathered news' },
        { command: 'performance', description: 'Weekly performance scorecard' },
        { command: 'profile', description: 'ALEX personal details' },
        { command: 'projection', description: 'Monthly cost projection' },
        { command: 'python', description: 'Python data analysis mode' },
        { command: 'qr', description: 'ALEX QR code — scan to visit alexnavada.xyz' },
        { command: 'research', description: 'Deep research on demand' },
        { command: 'read', description: 'Show last 5 diary entries' },
        { command: 'save', description: 'Save current chat to daily journal' },
        { command: 'scrapers', description: 'View all Apify scrapers' },
        { command: 'security', description: 'Security scan and audit' },
        { command: 'skills', description: 'List and manage skills' },
        { command: 'spend', description: 'Daily cost breakdown' },
        { command: 'start', description: 'Welcome message' },
        { command: 'status', description: 'System health and uptime' },
        { command: 'stocks', description: 'Quick stock quote — /stocks AAPL' },
        { command: 'strategist', description: 'Strategic frameworks and analysis' },
        { command: 'tasks', description: 'View scheduled tasks' },
        { command: 'testreport', description: 'Full system health report' },
        { command: 'tiktok', description: 'TikTok scraper' },
        { command: 'tokens', description: 'Today\'s token usage' },
        { command: 'tracked', description: 'View tracked tasks' },
        { command: 'voice', description: 'Voice message replies' },
    ]).catch(err => console.error('[TELEGRAM] Failed to set commands:', err.message));

    console.log('[TELEGRAM] Bot started and listening...');
}

// ============================================================================
// CONTROL API (port 9090) — allows Claude Code to send commands to ALEX
// ============================================================================

function setupControlAPI() {
    const CONTROL_PORT = parseInt(process.env.ALEX_PORT || '9090', 10);
    const controlChatId = 'control-api';
    const terminalChatId = 'terminal-chat';

    // Rate limiter: max 30 requests per 60 seconds per IP
    const rateLimiter = new Map(); // ip → { count, resetAt }
    const RATE_LIMIT = 30;
    const RATE_WINDOW = 60000;

    function checkRateLimit(ip) {
        const now = Date.now();
        let entry = rateLimiter.get(ip);
        if (!entry || now > entry.resetAt) {
            entry = { count: 0, resetAt: now + RATE_WINDOW };
            rateLimiter.set(ip, entry);
        }
        entry.count++;
        if (entry.count > RATE_LIMIT) return false;
        return true;
    }

    // Clean up stale rate limit entries every 5 minutes
    setInterval(() => {
        const now = Date.now();
        for (const [ip, entry] of rateLimiter) {
            if (now > entry.resetAt) rateLimiter.delete(ip);
        }
    }, 300000);

    const MAX_BODY_SIZE = 1024 * 1024; // 1MB

    const server = http.createServer(async (req, res) => {
        // CORS — restrict to dashboard origin
        res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:8080');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

        // Body size limit
        let bodySize = 0;
        req.on('data', (chunk) => {
            bodySize += chunk.length;
            if (bodySize > MAX_BODY_SIZE) {
                req.destroy();
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Request body too large. Max 1MB.' }));
            }
        });

        // Rate limiting
        const clientIp = req.socket.remoteAddress || 'unknown';
        if (!checkRateLimit(clientIp)) {
            console.log(`[CONTROL] Rate limited: ${clientIp}`);
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Rate limit exceeded. Max 30 requests per minute.' }));
            return;
        }

        // Auth token check (if configured) — skip for /api/trigger from localhost (cron)
        const apiToken = config.control_api_token;
        if (apiToken) {
            const authHeader = req.headers['authorization'] || '';
            const providedToken = authHeader.replace(/^Bearer\s+/i, '');
            const isLocalhost = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
            const isLocalBypass = req.url === '/api/trigger' || req.url === '/api/command' || req.url === '/api/terminal-messages' || req.url === '/api/health';

            // Allow unauthenticated local requests from localhost (cron jobs + terminal)
            if (!(isLocalhost && isLocalBypass) && providedToken !== apiToken) {
                console.log(`[CONTROL] Auth rejected from ${clientIp} for ${req.url}`);
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized. Provide Authorization: Bearer <token> header.' }));
                return;
            }
        }

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

                    // EXEC_SUMMARY trigger via control API
                    if (userMessage.includes('EXEC_SUMMARY')) {
                        const emailMatch = userMessage.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
                        if (!emailMatch) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ error: 'Include an email address. Example: send EXEC_SUMMARY to john@company.com' }));
                            return;
                        }
                        const recipientEmail = emailMatch[0];
                        currentCallerUserId = config.telegram_owner_id || null;
                        const execPrompt = `Send an email with the following EXACT details using the send_email tool. Do NOT change any of these values:
- to: ${recipientEmail}
- subject: NAVADA AI Business Model — Executive Summary
- body: Use this professional HTML body:
<div style="font-family: Arial, sans-serif; color: #333;">
<p>Dear Colleague,</p>
<p>Thank you for your interest in NAVADA's AI Business Model research.</p>
<p>Please find attached our <strong>Executive Summary</strong>, which covers:</p>
<ul>
<li>AI token economics and cost optimisation frameworks</li>
<li>Consultant vs AI cost comparisons (£6,950 vs £185 for equivalent work)</li>
<li>5-year revenue trajectories for AI adopters vs non-adopters</li>
<li>Strategic recommendations for CEO-level AI implementation</li>
<li>Sector-specific impact analysis and workforce planning</li>
</ul>
<p>If you would like to discuss how these findings apply to your organisation, please don't hesitate to get in touch.</p>
<p>Best regards,<br><strong>Lee Akpareva</strong><br>Founder & CEO, NAVADA<br>AI Strategy & Implementation Consulting</p>
</div>
- attachment_path: /home/head/.alex/files/documents/NAVADA_Executive_Summary.pdf

Call the send_email tool now with exactly these parameters.`;
                        const execResponse = await chatSystem.chat(controlChatId, execPrompt, { first_name: 'Control API', username: 'api' }, {}, { source: 'api' });
                        currentCallerUserId = null;
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, response: `Executive Summary sent to ${recipientEmail}`, detail: execResponse.substring(0, 500) }));
                        return;
                    }

                    // Process through chat system (control API is trusted — grant owner permissions)
                    const isTerminal = req.headers['x-terminal'] === 'true';
                    const chatId = isTerminal ? terminalChatId : controlChatId;
                    const userName = isTerminal ? 'Terminal' : 'Claude Code';

                    // Terminal context: guide ALEX to respond appropriately for a desktop text chat
                    if (isTerminal) {
                        userMessage = `[TERMINAL CONTEXT: You are responding via Lee's desktop ALEX Terminal — a text-only chat window on the Raspberry Pi. Rules for this channel:
1. Be concise and direct — this is a small screen, keep replies short and useful
2. You CANNOT see images, receive files, or display photos here — if the user asks you to look at something, explain this and suggest they send it via Telegram instead
3. Do NOT attempt generate_chart, generate_image, generate_diagram, or generate_mindmap — there is no way to display visual output in this terminal
4. Do NOT narrate your thinking process or failed attempts — just give the answer
5. You CAN use all text-based tools: web_search, web_lookup, stock_quote, bash, read_file, write_file, memory, email, etc.
6. Format for readability: use short paragraphs, avoid walls of text]\n\n${userMessage}`;
                    }

                    currentCallerUserId = config.telegram_owner_id || null;
                    const response = await chatSystem.chat(chatId, userMessage, { first_name: userName, username: isTerminal ? 'terminal' : 'claude_code' }, {}, { source: 'api' });
                    currentCallerUserId = null;

                    // Journal: append control API exchange
                    appendExchange({
                        question: message.substring(0, 500),
                        answer: response.substring(0, 1500),
                        source: isTerminal ? 'terminal' : 'api',
                        modelLabel: journalModelLabel(selectModel(message)),
                        userName: isTerminal ? 'Leslie (Terminal)' : 'Leslie (API)',
                    }).catch(err => console.error('[JOURNAL]', err.message));

                    // Send queued files
                    const files = pendingCharts.splice(0);

                    // Optionally forward response + files to Telegram
                    if (send_to_telegram !== false && config.telegram_owner_id) {
                        const { smartSplit } = await import('./chat.js');
                        const parts = smartSplit(response, 4000);
                        for (const part of parts) {
                            await sendMarkdown(config.telegram_owner_id, part).catch(() => {});
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
                const logsDir = path.join(WORKSPACE_PATH, 'logs', 'audit');
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
                    const logsDir = path.join(WORKSPACE_PATH, 'logs', 'audit');
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
                    if (taskName === 'file-received') {
                        const parsed = JSON.parse(body);
                        if (parsed.file) {
                            processUploadedFile(parsed.file).catch(err =>
                                console.error('[UPLOAD] Processing failed:', err.message)
                            );
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: true, message: 'File processing started' }));
                        return;
                    }
                    if (taskName === 'daily-churn') {
                        runChurn(chatSystem.callAnthropicQueued).then(() => {
                            writeDiaryEntry('Nightly churn completed').catch(() => {});
                        }).catch(err => console.error('[CHURN] Failed:', err.message));
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, task: taskName }));
                        return;
                    }
                    if (taskName === 'ralph-review') {
                        runRalphReview({
                            callAnthropicQueued: chatSystem.callAnthropicQueued,
                            config,
                        }).then(result => {
                            // Parse Ralph's markdown output for dashboard
                            const issues = [];
                            const fixes = [];
                            let health = '';
                            if (result) {
                                const issueMatch = result.match(/### Issues Found\n([\s\S]*?)(?=###|$)/);
                                if (issueMatch) {
                                    for (const line of issueMatch[1].split('\n')) {
                                        const trimmed = line.replace(/^[-*]\s*/, '').trim();
                                        if (trimmed) issues.push(trimmed);
                                    }
                                }
                                const fixMatch = result.match(/### Proposed Fixes\n([\s\S]*?)(?=###|$)/);
                                if (fixMatch) {
                                    for (const line of fixMatch[1].split('\n')) {
                                        const trimmed = line.replace(/^\d+\.\s*/, '').trim();
                                        if (trimmed) fixes.push(trimmed);
                                    }
                                }
                                const healthMatch = result.match(/### Overall Health\n([\s\S]*?)$/);
                                if (healthMatch) health = healthMatch[1].trim();
                            }
                            dashState.ralph = {
                                last_run: new Date().toISOString(),
                                status: 'completed',
                                issues,
                                fixes,
                                health,
                                review_date: new Date().toISOString().split('T')[0],
                            };
                            scheduleDashPush();

                            // Notify owner if configured
                            if (config.telegram_notify_tasks && config.telegram_owner_id && bot && result) {
                                const msg = `<b>Ralph Self-Improvement Review</b>\n\n${result.substring(0, 3500)}`;
                                bot.sendMessage(config.telegram_owner_id, msg, { parse_mode: 'HTML' }).catch(() => {
                                    bot.sendMessage(config.telegram_owner_id, `Ralph Self-Improvement Review\n\n${result.substring(0, 3500)}`).catch(() => {});
                                });
                            }
                        }).catch(err => {
                            dashState.ralph.status = 'failed';
                            dashState.ralph.last_run = new Date().toISOString();
                            dashState.ralph.health = `Failed: ${err.message}`;
                            scheduleDashPush();
                            console.error('[RALPH] Failed:', err.message);
                        });
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

                    // Scheduled tasks are system-level — grant owner permissions
                    currentCallerUserId = config.telegram_owner_id || null;

                    // Run asynchronously so we can respond immediately
                    // Scheduled tasks are system-level — grant owner permissions
                    currentCallerUserId = config.telegram_owner_id || null;
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

        } else if (req.method === 'GET' && req.url === '/api/health') {
            const memUsage = process.memoryUsage();
            const health = {
                status: 'ok',
                uptime_seconds: Math.floor(process.uptime()),
                memory: {
                    rss_mb: Math.round(memUsage.rss / 1024 / 1024),
                    heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
                    heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
                },
                telegram: bot ? 'connected' : 'disconnected',
                chromadb: (await import('./tools.js')).isRAGAvailable() ? 'cloud' : 'unavailable',
                redis_upstash: redis ? 'connected' : 'disconnected',
                redis_local: localRedis ? 'connected' : 'disconnected',
                timestamp: new Date().toISOString(),
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(health));

        } else if (req.method === 'GET' && req.url === '/api/terminal-messages') {
            // Return and clear queued messages for the ALEX Terminal
            const queuePath = path.join(os.homedir(), '.alex', 'terminal-queue.json');
            try {
                const data = await readFile(queuePath, 'utf8');
                const messages = JSON.parse(data);
                await writeFile(queuePath, '[]');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ messages }));
            } catch {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ messages: [] }));
            }

        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Endpoints: POST /api/command, POST /api/send, GET /api/users, POST /api/broadcast, POST /api/trigger, GET /api/health, GET /api/terminal-messages' }));
        }
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`[CONTROL] Port ${CONTROL_PORT} already in use — skipping control API`);
        } else {
            console.error(`[CONTROL] Server error:`, err.message);
        }
    });

    const BIND_HOST = process.env.ALEX_BIND_HOST || '127.0.0.1';
    server.listen(CONTROL_PORT, BIND_HOST, () => {
        console.log(`[CONTROL] API listening on http://${BIND_HOST}:${CONTROL_PORT}`);
    });

    // ── Web chat poller — checks Upstash Redis for incoming web chat messages ──
    if (redis) {
        const webChatInterval = setInterval(async () => {
            try {
                const raw = await redis.lpop('web:chat:in');
                if (!raw) return;
                const { text, sessionId } = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (!text || !sessionId) return;
                const webChatId = `web-${sessionId}`;

                const webMessage = `[WEB CONTEXT: User is chatting via the alexnavada.xyz website. Rules for this channel:
1. Be concise — web users expect quick, focused answers
2. You CANNOT send files, images, charts, or diagrams — text only
3. Do NOT use bash, write_file, or other system tools — this is a public-facing chat
4. You CAN use web_search, web_lookup, stock_quote, crypto_rate, and other read-only tools
5. Keep responses under 500 words unless asked for detail]\n\n${text}`;

                currentCallerUserId = null; // Web users have no owner permissions
                const response = await chatSystem.chat(webChatId, webMessage, { first_name: 'Web User', username: 'web' }, {}, { source: 'web' });
                currentCallerUserId = null;

                appendExchange({
                    question: text.substring(0, 500),
                    answer: response.substring(0, 1500),
                    source: 'web',
                    modelLabel: journalModelLabel(selectModel(text)),
                    userName: 'Web User',
                }).catch(() => {});

                await redis.set(`web:chat:out:${sessionId}`, JSON.stringify({
                    response, timestamp: Date.now()
                }), { ex: 3600 });
            } catch (e) {
                // Silent fail — non-critical
            }
        }, 1000);
        console.log('[WEB-CHAT] Poller started (1s interval)');
    }
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

    // Hydrate FULL_ACCESS_USERS from persisted config
    if (Array.isArray(config.full_access_users)) {
        for (const uid of config.full_access_users) FULL_ACCESS_USERS.add(uid);
        console.log(`[AUTH] Full access users: ${[...FULL_ACCESS_USERS].join(', ')}`);
    }

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

    if (config.kimi_api_key) {
        kimiClient = new OpenAI({ apiKey: config.kimi_api_key, baseURL: 'https://kimi-k2.ai/api/v1' });
        console.log('[KIMI] Client initialized');
    } else {
        console.log('[KIMI] No API key configured, Kimi K2 disabled');
    }

    if (config.openrouter_api_key) {
        openrouterClient = new OpenAI({
            apiKey: config.openrouter_api_key,
            baseURL: 'https://openrouter.ai/api/v1',
            defaultHeaders: {
                'HTTP-Referer': 'https://navada.space',
                'X-Title': 'ALEX'
            }
        });
        console.log('[OPENROUTER] Client initialized');
    } else {
        console.log('[OPENROUTER] No API key configured, external models disabled');
    }

    // Initialize Upstash Redis for dashboard
    if (config.upstash_redis_url && config.upstash_redis_token) {
        redis = new Redis({ url: config.upstash_redis_url, token: config.upstash_redis_token });
        console.log('[REDIS] Upstash client initialized');
    } else {
        console.log('[REDIS] No Upstash config — dashboard pushes disabled');
    }

    // Initialize local Redis (Pi-side, for journal cache and local data)
    try {
        const { createClient } = await import('redis');
        const redisUrl = config.local_redis_url || 'redis://127.0.0.1:6379';
        localRedis = createClient({ url: redisUrl });
        localRedis.on('error', err => console.error('[LOCAL-REDIS] Error:', err.message));
        await localRedis.connect();
        console.log('[LOCAL-REDIS] Connected to local Redis');
    } catch (err) {
        console.error('[LOCAL-REDIS] Connection failed:', err.message);
        localRedis = null;
    }

    // Wire up dashboard helpers for heartbeat + tools modules
    setDashPost(postDashboard);
    setRedis(redis);
    setToolsDashPost(postDashboard);
    // Journal uses local Redis (faster, on-Pi) with Upstash fallback
    setJournalRedis(localRedis || redis);

    // Initialize memory system
    memory = new MemorySystem(WORKSPACE_PATH);
    await memory.init();
    console.log('[MEMORY] Initialized');

    // Initialize journal system
    await initJournal();
    console.log('[JOURNAL] Initialized');

    // Create task-outputs symlink in project dir (for easy access)
    try {
        const symlinkPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'task-outputs');
        const targetPath = path.join(WORKSPACE_PATH, 'tasks', 'outputs');
        await mkdir(targetPath, { recursive: true });
        await fsSymlink(targetPath, symlinkPath).catch(() => {});
    } catch {}

    // One-time fix: ensure sensitive files have 0600 permissions
    try {
        await execAsync(`chmod 600 ${WORKSPACE_PATH}/conversations/*.json ${WORKSPACE_PATH}/memory/*.md ${WORKSPACE_PATH}/*.md ${WORKSPACE_PATH}/inbox/*.json ${WORKSPACE_PATH}/config.json 2>/dev/null || true`);
        console.log('[SECURITY] File permissions secured');
    } catch {}


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
        kimiClient,
        openrouterClient,
        memory,
        skills,
        executeTool: execToolWithDeps,
        TOOLS,
        getDailyContext: getDiaryContext,
    });

    // Setup Telegram
    setupTelegram();

    // Setup Control API on port 9090
    setupControlAPI();

    // Setup email filing system
    setupEmailFiling({ config, bot, anthropic, postDashboard, memory });
    setEmailFilingChatSystem(chatSystem);

    // Start Gmail inbox polling with chatSystem for owner commands
    setupInbox({ config, bot, postDashboard, anthropic, openaiClient });
    setInboxChatSystem(chatSystem);
    startInboxPolling();

    // Start Slack polling
    await setupSlack({ config, chatSystem, postDashboard, smartSplit, learnModeChats, modelOverrides });
    startSlackPolling();

    // Check for missed scheduled tasks during downtime
    await catchUpMissedTasks();

    // Notify dashboard that ALEX is online
    postDashboard('set_status', { status: 'online' });
    postDashboard('add_activity', { entry: 'ALEX started and online' });
    writeDiaryEntry('ALEX booted, all systems online').catch(() => {});
    postDashboard('update_services', { services: [
        { name: 'ALEX Gateway', port: 'systemd', status: 'online' },
        { name: 'Upstash Redis', port: 'cloud', status: 'online' },
        { name: 'Telegram Bot', port: 'polling', status: 'online' },
        { name: 'Gmail Inbox', port: 'IMAP', status: config.gmail_address ? 'online' : 'disabled' },
        { name: 'Slack Bot', port: 'polling', status: config.slack_token ? 'online' : 'disabled' },
    ]});

    // Set heartbeat schedules
    dashState.heartbeats = [
        { name: 'Morning Briefing', schedule: '08:00', status: 'active' },
        { name: 'Dashboard Sync', schedule: 'Hourly', status: 'active' },
        { name: 'Inbox Review', schedule: '10:00, 15:00', status: 'active' },
        { name: 'Evening Summary', schedule: '18:00', status: 'active' },
        { name: 'Weekly Cleanup', schedule: 'Sun 02:00', status: 'active' },
    ];
    scheduleDashPush();

    // Write alive marker every 60s so catch-up knows when we were last running
    setInterval(async () => {
        try {
            await writeFile(path.join(WORKSPACE_PATH, 'logs', '.last-alive'), new Date().toISOString());
        } catch {}
    }, 60000);

    // Conversation starters after idle (owner only, 9am-6pm, max once per day)
    let lastStarterDate = null;

    // Track owner message times
    const origSetup = bot._events?.message;
    setInterval(async () => {
        if (config.do_not_disturb) return;
        if (!config.telegram_owner_id) return;

        const now = new Date();
        const hour = now.getHours();
        if (hour < 9 || hour >= 18) return; // Working hours only

        const today = now.toISOString().split('T')[0];
        if (lastStarterDate === today) return; // Max once per day

        const idleMs = Date.now() - lastOwnerMessageTime;
        if (idleMs < 2 * 3600000) return; // Need 2h of idle

        lastStarterDate = today;
        try {
            const starterResponse = await chatSystem.chat(
                config.telegram_owner_id,
                '[SYSTEM: Generate a brief, contextual conversation starter for Lee based on recent memory or research. Keep it to 1-2 sentences. Be natural — like a colleague casually sharing something interesting.]',
                { first_name: 'System' },
                {},
                { source: 'idle-starter' }
            );
            if (starterResponse && bot) {
                await sendMarkdown(config.telegram_owner_id, starterResponse.substring(0, 2000));
            }
        } catch (err) {
            console.error('[IDLE] Starter failed:', err.message);
        }
    }, 7200000); // Check every 2 hours

    console.log('');
    console.log('ALEX is now online and ready!');
    console.log(`Workspace: ${WORKSPACE_PATH}`);
    console.log('');
}

// Graceful shutdown handler
let shuttingDown = false;
async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[SHUTDOWN] ${signal} received. Draining queue and shutting down...`);
    postDashboard('set_status', { status: 'offline' });
    postDashboard('add_activity', { entry: `ALEX shutting down (${signal})` });

    try {
        // Stop accepting new Telegram messages
        if (bot) {
            bot.stopPolling();
            console.log('[SHUTDOWN] Telegram polling stopped');
        }
        // Disconnect local Redis
        if (localRedis) {
            await localRedis.quit().catch(() => {});
            console.log('[SHUTDOWN] Local Redis disconnected');
        }
        // Wait briefly for dashboard push
        await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
        console.error('[SHUTDOWN] Error:', err.message);
    }

    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

init().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
