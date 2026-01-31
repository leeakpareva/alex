#!/usr/bin/env node
/**
 * ALEX - Global Economist at NAVADA
 * Main entry point — bot setup, init, message routing
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import TelegramBot from 'node-telegram-bot-api';
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
import { TOOLS, executeTool, checkRAG, indexRAG, isRAGAvailable } from './tools.js';
import { handleScheduledTask, BUILTIN_TASKS, runDashboardSync, runCleanup } from './heartbeat.js';
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

        const welcome = `*ALEX - Global Economist at NAVADA*

Welcome! I'm ALEX, your AI economist and colleague at NAVADA.

I can:
• Research global markets, startups, and economic trends
• Manage files and run code
• Draft and send emails
• Generate PDF reports and email them
• Schedule tasks and reminders
• Remember everything we discuss
• Create new skills to extend my abilities

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
                response = await chatSystem.chat(chatId, contentBlocks || userMessage, msg.from);
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

    // Check for missed scheduled tasks during downtime
    await catchUpMissedTasks();

    // Notify dashboard that ALEX is online
    postDashboard('set_status', { status: 'online' });
    postDashboard('add_activity', { entry: 'ALEX started and online' });
    postDashboard('update_services', { services: [
        { name: 'ALEX Gateway', port: 'systemd', status: 'online' },
        { name: 'Dashboard Server', port: '8080', status: 'online' },
        { name: 'Telegram Bot', port: 'polling', status: 'online' },
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
