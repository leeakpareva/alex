#!/usr/bin/env node
/**
 * ALEX - Global Economist at NAVADA VC
 * Main entry point — bot setup, init, message routing
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import os from 'os';
import path from 'path';
import http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

import { WORKSPACE_PATH, loadConfig } from './config.js';
import { appendFile, mkdir } from 'fs/promises';
import { MemorySystem } from './memory.js';
import { SkillsSystem } from './skills.js';
import { TOOLS, executeTool, checkRAG, indexRAG, isRAGAvailable } from './tools.js';
import { handleScheduledTask, loadScheduledTasks, setupHeartbeat } from './heartbeat.js';
import { createChatSystem, getDailyTokenStats, smartSplit } from './chat.js';

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
        cron,
    });
    // Queue chart images for sending after response completes
    if (result && result.send_photo && result.path) {
        pendingCharts.push({ path: result.path, caption: result.caption || '' });
    }
    return result;
}

function heartbeatDeps() {
    return {
        callAnthropicQueued: chatSystem.callAnthropicQueued,
        processResponse: chatSystem.processResponse,
        buildSystemPrompt: chatSystem.buildSystemPrompt,
        config,
        bot,
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

async function postDashboard(action, payload) {
    const body = JSON.stringify({ action, ...payload });
    return new Promise((resolve) => {
        const req = http.request({
            hostname: '127.0.0.1', port: 8080, path: '/api/update',
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, (res) => { res.resume(); resolve(); });
        req.on('error', () => resolve());
        req.end(body);
    });
}

// ============================================================================
// TELEGRAM BOT SETUP
// ============================================================================

function setupTelegram() {
    bot = new TelegramBot(config.telegram_bot_token, { polling: true });

    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        const welcome = `*ALEX - Global Economist at NAVADA VC*

Welcome! I'm ALEX, your AI economist and colleague at NAVADA VC.

I have full access to this Raspberry Pi and can:
• Research global markets, startups, and economic trends
• Manage files and run code
• Draft and send emails
• Generate PDF reports and email them
• Schedule tasks and reminders
• Remember everything we discuss
• Create new skills to extend my abilities

Your Telegram ID: \`${userId}\`

Just message me naturally - I'm here to help!`;

        await bot.sendMessage(chatId, welcome, { parse_mode: 'Markdown' });
        await memory.appendMemory('user', `New session started with ${msg.from.first_name} (ID: ${userId})`);
    });

    bot.onText(/\/status/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const { stdout: uptime } = await execAsync('uptime -p');
            const { stdout: temp } = await execAsync('vcgencmd measure_temp 2>/dev/null || echo "temp=N/A"');
            const { stdout: disk } = await execAsync("df -h / | tail -1 | awk '{print $5}'");
            const { stdout: mem } = await execAsync("free -m | awk '/Mem:/ {printf \"%.1f%%\", $3/$2 * 100}'");

            const tasks = Array.from(scheduledTasks.keys());

            const status = `*ALEX Status*

*System:*
• Uptime: ${uptime.trim()}
• Temperature: ${temp.trim().replace('temp=', '')}
• Disk Usage: ${disk.trim()}
• Memory: ${mem.trim()}

*Scheduled Tasks:* ${tasks.length > 0 ? tasks.join(', ') : 'None'}

*Workspace:* \`${WORKSPACE_PATH}\``;

            await bot.sendMessage(chatId, status, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(chatId, `Error getting status: ${error.message}`);
        }
    });

    bot.onText(/\/memory/, async (msg) => {
        const chatId = msg.chat.id;
        const categories = ['user', 'projects', 'research', 'tasks', 'knowledge'];
        let summary = '*Memory Summary*\n\n';
        for (const cat of categories) {
            const content = await memory.getMemory(cat);
            const lines = content.split('\n').filter(l => l.trim()).length;
            summary += `• ${cat}: ${lines} entries\n`;
        }
        await bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/skills/, async (msg) => {
        const chatId = msg.chat.id;
        const allSkills = await skills.getAllSkills();
        let text = '*Available Skills*\n\n';
        for (const skill of allSkills) {
            text += `• \`${skill.name}\`\n`;
        }
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/tasks/, async (msg) => {
        const chatId = msg.chat.id;
        const tasks = Array.from(scheduledTasks.entries());
        if (tasks.length === 0) {
            await bot.sendMessage(chatId, 'No scheduled tasks.');
            return;
        }
        let text = '*Scheduled Tasks*\n\n';
        for (const [name] of tasks) {
            text += `• \`${name}\`\n`;
        }
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/tokens/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const stats = await getDailyTokenStats();
            let text = `*Token Usage Today*\n\n`;
            text += `Total API calls: ${stats.totalCalls}\n`;
            text += `Total input tokens: ${stats.totalIn.toLocaleString()}\n`;
            text += `Total output tokens: ${stats.totalOut.toLocaleString()}\n\n`;
            if (Object.keys(stats.byModel).length > 0) {
                text += `*By Model:*\n`;
                for (const [model, data] of Object.entries(stats.byModel)) {
                    const shortName = model.includes('haiku') ? 'Haiku' : model.includes('sonnet') ? 'Sonnet' : model;
                    text += `• ${shortName}: ${data.calls} calls, ${data.input.toLocaleString()} in / ${data.output.toLocaleString()} out\n`;
                }
            }
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(chatId, `Error getting token stats: ${error.message}`);
        }
    });

    bot.onText(/\/clear/, async (msg) => {
        const chatId = msg.chat.id;
        await memory.saveConversation(chatId, []);
        await bot.sendMessage(chatId, 'Conversation history cleared.');
    });

    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        const help = `*ALEX Commands*

/start - Welcome message
/status - System status
/memory - View memory summary
/skills - List available skills
/tasks - List scheduled tasks
/tokens - Daily token usage stats
/clear - Clear conversation history
/help - This message

*Tips:*
• Just chat naturally - I understand context
• Ask me to remember things
• I can create new skills for recurring tasks
• I can generate PDF reports and email them
• I'll proactively notify you of important findings`;

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
            if (msg.text) {
                userMessage = msg.text;
            } else if (msg.document) {
                userMessage = `[User sent a file: ${msg.document.file_name}]`;
            } else if (msg.photo) {
                userMessage = '[User sent a photo]';
            } else if (msg.voice) {
                userMessage = '[User sent a voice message]';
            }

            if (!userMessage) return;

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

            // Natural acknowledgement
            const acks = ['On it.', 'Give me a moment.', 'Looking into it.', 'One sec.'];
            const ack = acks[Math.floor(Math.random() * acks.length)];
            await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
            await bot.sendMessage(chatId, ack, { parse_mode: 'Markdown' });

            // Keep typing indicator alive
            const typingInterval = setInterval(() => {
                bot.sendChatAction(chatId, 'typing').catch(() => {});
            }, 4000);

            let response;
            try {
                response = await chatSystem.chat(chatId, userMessage, msg.from);
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

            // Send any generated charts as photos
            const charts = pendingCharts.splice(0);
            for (const chart of charts) {
                try {
                    await bot.sendPhoto(chatId, chart.path, {
                        caption: chart.caption || undefined,
                    });
                } catch (photoErr) {
                    console.error('[CHART] Failed to send photo:', photoErr.message);
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
// INITIALIZATION
// ============================================================================

async function init() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║     ALEX - Global Economist            ║');
    console.log('║     NAVADA VC | Starting up...         ║');
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

    // Load scheduled tasks
    await loadScheduledTasks(scheduledTasks, heartbeatDeps());

    // Setup heartbeat (includes 9pm wrap-up)
    setupHeartbeat(heartbeatDeps());

    // Periodic conversation cleanup (daily at 3am)
    cron.schedule('0 3 * * *', () => {
        memory.cleanupOldConversations().catch(err => console.error('[CLEANUP]', err.message));
    });

    // Setup Telegram
    setupTelegram();

    console.log('');
    console.log('ALEX is now online and ready!');
    console.log(`Workspace: ${WORKSPACE_PATH}`);
    console.log('');
}

init().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
