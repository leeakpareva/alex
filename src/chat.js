/**
 * Chat system — conversation handling, system prompt, response processing, API calls
 */

import os from 'os';
import path from 'path';
import { WORKSPACE_PATH } from './config.js';
import { RequestQueue } from './queue.js';
import { queryRAG } from './tools.js';

// ============================================================================
// TOKEN USAGE LOGGING
// ============================================================================

import fs from 'fs/promises';

export async function logTokenUsage(model, usage, context = {}) {
    if (!usage) return;
    try {
        const date = new Date().toISOString().split('T')[0];
        const logDir = path.join(WORKSPACE_PATH, 'logs', 'tokens');
        await fs.mkdir(logDir, { recursive: true });
        const logFile = path.join(logDir, `tokens_${date}.jsonl`);
        const entry = {
            timestamp: new Date().toISOString(),
            model,
            input_tokens: usage.input_tokens || 0,
            output_tokens: usage.output_tokens || 0
        };
        // Add context fields if provided (chatId, source, taskName)
        if (context.chatId) entry.chatId = context.chatId;
        if (context.source) entry.source = context.source;
        if (context.taskName) entry.taskName = context.taskName;
        console.log(`[TOKENS] ${model} — in:${entry.input_tokens} out:${entry.output_tokens}${context.source ? ` [${context.source}]` : ''}`);
        await fs.appendFile(logFile, JSON.stringify(entry) + '\n');
    } catch (err) {
        console.error('[TOKENS] Log error:', err.message);
    }
}

// Pricing: USD per 1M tokens, converted to GBP at 0.79
const MODEL_PRICING = {
    'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },
    'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
    'deepseek-chat': { input: 0.14, output: 0.28 },
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4.1': { input: 2.00, output: 8.00 },
    'gpt-4.1-mini': { input: 0.40, output: 1.60 },
    'gpt-4.1-nano': { input: 0.10, output: 0.40 },
    'o3': { input: 10.00, output: 40.00 },
    'o4-mini': { input: 1.10, output: 4.40 },
};
const USD_TO_GBP = 0.79;

function getModelPricing(model) {
    if (MODEL_PRICING[model]) return MODEL_PRICING[model];
    if (model.includes('haiku')) return MODEL_PRICING['claude-3-5-haiku-20241022'];
    if (model.includes('sonnet')) return MODEL_PRICING['claude-sonnet-4-20250514'];
    if (model.includes('deepseek')) return MODEL_PRICING['deepseek-chat'];
    if (MODEL_PRICING[model]) return MODEL_PRICING[model];
    if (model.includes('gpt-4.1-nano')) return MODEL_PRICING['gpt-4.1-nano'];
    if (model.includes('gpt-4.1-mini')) return MODEL_PRICING['gpt-4.1-mini'];
    if (model.includes('gpt-4.1')) return MODEL_PRICING['gpt-4.1'];
    if (model.includes('gpt-4o')) return MODEL_PRICING['gpt-4o'];
    if (model === 'o3') return MODEL_PRICING['o3'];
    if (model === 'o4-mini') return MODEL_PRICING['o4-mini'];
    // Default to Haiku pricing for unknown models
    return MODEL_PRICING['claude-3-5-haiku-20241022'];
}

function calcCostGbp(inputTokens, outputTokens, pricing) {
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    return (inputCost + outputCost) * USD_TO_GBP;
}

function getModelLabel(model) {
    if (model.includes('haiku')) return 'Haiku';
    if (model.includes('sonnet')) return 'Sonnet';
    if (model.includes('deepseek')) return 'DeepSeek';
    if (model === 'o3') return 'o3';
    if (model === 'o4-mini') return 'o4-mini';
    if (model === 'gpt-4.1-nano') return 'GPT-4.1 Nano';
    if (model === 'gpt-4.1-mini') return 'GPT-4.1 Mini';
    if (model === 'gpt-4.1') return 'GPT-4.1';
    if (model.includes('gpt')) return 'GPT-4o';
    return model;
}

export async function getLifetimeTokenStats() {
    const logDir = path.join(WORKSPACE_PATH, 'logs', 'tokens');
    const files = await fs.readdir(logDir);
    const tokenFiles = files.filter(f => f.startsWith('tokens_') && f.endsWith('.jsonl')).sort();

    let totalIn = 0, totalOut = 0, totalCalls = 0;
    const byModel = {};
    const byDay = [];

    for (const file of tokenFiles) {
        const date = file.replace('tokens_', '').replace('.jsonl', '');
        let dayCalls = 0, dayIn = 0, dayOut = 0, dayCost = 0;

        const fileHandle = await fs.open(path.join(logDir, file), 'r');
        try {
            for await (const line of fileHandle.readLines()) {
                if (!line.trim()) continue;
                const entry = JSON.parse(line);
                const inTok = entry.input_tokens || 0;
                const outTok = entry.output_tokens || 0;
                const pricing = getModelPricing(entry.model);
                const cost = calcCostGbp(inTok, outTok, pricing);
                const label = getModelLabel(entry.model);

                totalIn += inTok;
                totalOut += outTok;
                totalCalls++;
                dayCalls++;
                dayIn += inTok;
                dayOut += outTok;
                dayCost += cost;

                if (!byModel[label]) byModel[label] = { calls: 0, in: 0, out: 0, costGbp: 0 };
                byModel[label].calls++;
                byModel[label].in += inTok;
                byModel[label].out += outTok;
                byModel[label].costGbp += cost;
            }
        } finally {
            await fileHandle.close();
        }

        byDay.push({ date, calls: dayCalls, tokens: dayIn + dayOut, costGbp: dayCost });
    }

    const totalCostGbp = Object.values(byModel).reduce((s, m) => s + m.costGbp, 0);
    const firstDay = tokenFiles.length > 0 ? tokenFiles[0].replace('tokens_', '').replace('.jsonl', '') : null;

    return {
        firstDay,
        totalDays: tokenFiles.length,
        totalCalls,
        totalIn,
        totalOut,
        totalTokens: totalIn + totalOut,
        totalCostGbp,
        byModel,
        byDay,
        avgCostPerDay: tokenFiles.length > 0 ? totalCostGbp / tokenFiles.length : 0,
        avgCostPerCall: totalCalls > 0 ? totalCostGbp / totalCalls : 0,
    };
}

export async function getDailyTokenStats() {
    try {
        const date = new Date().toISOString().split('T')[0];
        const logFile = path.join(WORKSPACE_PATH, 'logs', 'tokens', `tokens_${date}.jsonl`);
        // Stream the file line-by-line instead of loading all at once
        const fileHandle = await fs.open(logFile, 'r');
        let totalIn = 0, totalOut = 0, totalCalls = 0;
        const byModel = {};
        try {
            for await (const line of fileHandle.readLines()) {
                if (!line.trim()) continue;
                const entry = JSON.parse(line);
                totalIn += entry.input_tokens;
                totalOut += entry.output_tokens;
                totalCalls++;
                if (!byModel[entry.model]) byModel[entry.model] = { input: 0, output: 0, calls: 0 };
                byModel[entry.model].input += entry.input_tokens;
                byModel[entry.model].output += entry.output_tokens;
                byModel[entry.model].calls += 1;
            }
        } finally {
            await fileHandle.close();
        }
        return { totalIn, totalOut, totalCalls, byModel };
    } catch {
        return { totalIn: 0, totalOut: 0, totalCalls: 0, byModel: {} };
    }
}

export async function getTokenStatsBySource() {
    const logDir = path.join(WORKSPACE_PATH, 'logs', 'tokens');
    const files = await fs.readdir(logDir);
    const tokenFiles = files.filter(f => f.startsWith('tokens_') && f.endsWith('.jsonl')).sort();

    const bySource = {};
    const byTask = {};
    const GBP_RATE = 0.79;

    for (const file of tokenFiles) {
        const fileHandle = await fs.open(path.join(logDir, file), 'r');
        try {
            for await (const line of fileHandle.readLines()) {
                if (!line.trim()) continue;
                const entry = JSON.parse(line);
                const inTok = entry.input_tokens || 0;
                const outTok = entry.output_tokens || 0;
                const pricing = getModelPricing(entry.model);
                const costUsd = (inTok / 1_000_000) * pricing.input + (outTok / 1_000_000) * pricing.output;

                const source = entry.source || 'unknown';
                if (!bySource[source]) bySource[source] = { calls: 0, tokens: 0, costUsd: 0 };
                bySource[source].calls++;
                bySource[source].tokens += inTok + outTok;
                bySource[source].costUsd += costUsd;

                if (entry.taskName) {
                    if (!byTask[entry.taskName]) byTask[entry.taskName] = { calls: 0, tokens: 0, costUsd: 0 };
                    byTask[entry.taskName].calls++;
                    byTask[entry.taskName].tokens += inTok + outTok;
                    byTask[entry.taskName].costUsd += costUsd;
                }
            }
        } finally {
            await fileHandle.close();
        }
    }

    return { bySource, byTask, GBP_RATE };
}

// ============================================================================
// MODEL SELECTION
// ============================================================================

const HAIKU_PATTERNS = [
    /^(hi|hey|hello|morning|evening|thanks|thank you|ok|okay|got it|sure|yes|no|yep|nope)\b/i,
    /^what('s| is) (the )?(time|date|day)/i,
    /^(good )?(morning|afternoon|evening|night)/i,
    /^how are you/i,
    /^\/?(status|help|memory|skills|tasks|clear|tokens)\b/i,
    /^(sounds good|perfect|great|awesome|nice|cool|noted|understood|will do|on it)\b/i,
    /^(what|who|where|when|how much|how many)\b.{0,60}$/i,
    /^(show|tell|list|give)\s(me|us)\b.{0,60}$/i,
];

// Sonnet auto-routes for complex building/creation tasks that Haiku can't handle well
const SONNET_PATTERNS = [
    // Building / creating things
    /\b(build|create|design|develop|implement|set up|make)\b.{0,30}\b(dashboard|app|website|page|site|interface|system|tool|server|api|bot|script|service|platform|database|pipeline|workflow|frontend|backend)\b/i,
    /\b(dashboard|app|website|page|site|interface|system|tool|server|api|bot|script|service|platform|database|pipeline|workflow|frontend|backend)\b.{0,30}\b(build|create|design|develop|implement|set up|make)\b/i,
    // Writing substantial content
    /\b(write|draft|compose|prepare)\b.{0,20}\b(report|proposal|business plan|strategy|whitepaper|analysis document|brief|memo|pitch)\b/i,
    // Refactoring / rewriting code
    /\b(refactor|rewrite|restructure|redesign|overhaul|migrate)\b/i,
    // Multi-step instructions
    /\b(step[- ]by[- ]step|full|complete|end[- ]to[- ]end|from scratch|whole|entire)\b.{0,20}\b(build|create|design|develop|implement|guide|setup|solution)\b/i,
    // Debugging complex issues
    /\b(debug|fix|troubleshoot|diagnose)\b.{0,30}\b(issue|bug|error|problem|crash)\b.{0,30}\b(in|with|across)\b/i,
    // Visual output requests (charts, graphs, diagrams, images, PDFs)
    /\b(chart|graph|plot|diagram|visuali[sz]e|infographic|mindmap|mind map|dashboard)\b/i,
    /\b(generate|create|make|draw|show|send).{0,20}\b(image|picture|pic|photo|pdf|report)\b/i,
];

export const IMAGE_PATTERNS = [
    /\b(generate|create|make|draw|design)\b.*\b(image|picture|photo|illustration|logo|icon|graphic|visual|artwork)\b/i,
    /\b(image|picture|photo|illustration|logo|icon|graphic|visual|artwork)\b.*\b(of|for|showing|depicting)\b/i,
    /\b(dall-?e|image generat)/i,
];

const DEEPSEEK_PATTERNS = [
    /\bdeep research\b/i,
    /\bdeep dive\b/i,
    /\bthorough (research|analysis)\b/i,
    /\buse deepseek\b/i,
    /\bdetailed (research|analysis)\b/i,
];

// Explicit model override patterns — checked first, highest priority
const EXPLICIT_OVERRIDES = [
    // OpenAI models — specific patterns first, generic "use gpt" last
    { pattern: /\buse o3\b/i, model: 'o3', label: 'o3 (explicit)' },
    { pattern: /\buse o4[- ]?mini\b/i, model: 'o4-mini', label: 'o4-mini (explicit)' },
    { pattern: /\buse gpt[- ]?4\.1[- ]?nano\b/i, model: 'gpt-4.1-nano', label: 'gpt-4.1-nano (explicit)' },
    { pattern: /\buse gpt[- ]?4\.1[- ]?mini\b/i, model: 'gpt-4.1-mini', label: 'gpt-4.1-mini (explicit)' },
    { pattern: /\buse gpt[- ]?4\.1\b/i, model: 'gpt-4.1', label: 'gpt-4.1 (explicit)' },
    { pattern: /\buse gpt[- ]?4o\b/i, model: 'gpt-4o', label: 'gpt-4o (explicit)' },
    { pattern: /\buse (openai|gpt)\b/i, model: 'gpt-4.1', label: 'gpt-4.1 (explicit)' },
    // DeepSeek
    { pattern: /\buse deepseek\b/i, model: 'deepseek-chat', label: 'deepseek-chat (explicit)' },
    // Claude models
    { pattern: /\buse (claude|sonnet)\b/i, model: 'claude-sonnet-4-20250514', label: 'claude-sonnet-4 (explicit)' },
    { pattern: /\buse haiku\b/i, model: 'claude-3-5-haiku-20241022', label: 'claude-3.5-haiku (explicit)' },
    { pattern: /\buse opus\b/i, model: 'claude-opus-4-5-20251101', label: 'claude-opus-4.5 (explicit)' },
];

export function selectModel(userMessage) {
    const msg = (userMessage || '').trim();

    // 1. Explicit user overrides — always respected
    for (const { pattern, model, label } of EXPLICIT_OVERRIDES) {
        if (pattern.test(msg)) {
            console.log(`[MODEL] Selected ${label} for: "${msg.substring(0, 50)}"`);
            return model;
        }
    }

    // 2. DeepSeek patterns (deep research, thorough analysis, etc.)
    for (const pattern of DEEPSEEK_PATTERNS) {
        if (pattern.test(msg)) {
            console.log(`[MODEL] Selected deepseek-chat for: "${msg.substring(0, 50)}"`);
            return 'deepseek-chat';
        }
    }

    // 3. Sonnet for complex building/creation/visual tasks (check BEFORE Haiku)
    for (const pattern of SONNET_PATTERNS) {
        if (pattern.test(msg)) {
            console.log(`[MODEL] Selected claude-sonnet (complex task pattern) for: "${msg.substring(0, 50)}"`);
            return 'claude-sonnet-4-20250514';
        }
    }

    // 4. Haiku for short simple messages
    if (msg.length < 80) {
        for (const pattern of HAIKU_PATTERNS) {
            if (pattern.test(msg)) {
                console.log(`[MODEL] Selected claude-3.5-haiku for: "${msg.substring(0, 50)}"`);
                return 'claude-3-5-haiku-20241022';
            }
        }
    }

    // 5. Sonnet for longer, complex messages (200+ chars likely need reasoning)
    if (msg.length >= 200) {
        console.log(`[MODEL] Selected claude-sonnet (long message: ${msg.length} chars) for: "${msg.substring(0, 50)}"`);
        return 'claude-sonnet-4-20250514';
    }

    // Default to Haiku (cost-efficient for simple/short messages)
    console.log(`[MODEL] Selected claude-3.5-haiku (default) for: "${msg.substring(0, 50)}"`);
    return 'claude-3-5-haiku-20241022';
}

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

export class CircuitBreaker {
    constructor(maxFailures = 5, resetTimeMs = 5 * 60 * 1000) {
        this.failures = 0;
        this.maxFailures = maxFailures;
        this.resetTimeMs = resetTimeMs;
        this.openUntil = 0;
    }

    isOpen() {
        if (Date.now() > this.openUntil) {
            this.failures = 0;
            return false;
        }
        return this.failures >= this.maxFailures;
    }

    recordFailure() {
        this.failures++;
        if (this.failures >= this.maxFailures) {
            this.openUntil = Date.now() + this.resetTimeMs;
            console.log(`[CIRCUIT] Open — ${this.maxFailures} consecutive failures, backing off ${this.resetTimeMs / 1000}s`);
        }
    }

    recordSuccess() {
        this.failures = 0;
    }
}

// ============================================================================
// CHAT SYSTEM FACTORY
// ============================================================================

export function createChatSystem({ anthropic, openaiClient, deepseekClient, memory, skills, executeTool, TOOLS }) {
    const requestQueue = new RequestQueue();
    const circuitBreaker = new CircuitBreaker();
    const deepseekBreaker = new CircuitBreaker(5, 5 * 60 * 1000);
    const openaiBreaker = new CircuitBreaker(5, 5 * 60 * 1000);

    async function callAnthropicWithRetry(params, maxRetries = 5, context = {}) {
        if (circuitBreaker.isOpen()) {
            throw new Error('Circuit breaker open — API calls temporarily suspended after repeated failures. Will retry automatically.');
        }

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const result = await anthropic.messages.create(params);
                logTokenUsage(params.model, result.usage, context);
                circuitBreaker.recordSuccess();
                return result;
            } catch (error) {
                const isRateLimit = error?.status === 429 || error?.error?.type === 'rate_limit_error' ||
                    (error.message && error.message.toLowerCase().includes('rate limit'));
                const isOverloaded = error?.status === 529 || (error.message && error.message.toLowerCase().includes('overloaded'));

                if ((isRateLimit || isOverloaded) && attempt < maxRetries) {
                    const retryAfter = error?.headers?.['retry-after'];
                    const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 60000);
                    console.log(`[RETRY] Rate limited (attempt ${attempt + 1}/${maxRetries}), waiting ${Math.round(waitMs / 1000)}s...`);
                    await new Promise(resolve => setTimeout(resolve, waitMs));
                    continue;
                }

                circuitBreaker.recordFailure();
                throw error;
            }
        }

        // Fallback to OpenAI
        if (openaiClient && !openaiBreaker.isOpen()) {
            console.log('[FALLBACK] Anthropic failed after all retries, attempting OpenAI GPT-4o...');
            try {
                const openaiMessages = (params.messages || []).map(m => {
                    if (typeof m.content === 'string') return { role: m.role, content: m.content };
                    const textParts = (Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'text').map(b => b.text);
                    return { role: m.role, content: textParts.join('\n') || JSON.stringify(m.content) };
                });
                if (params.system) {
                    openaiMessages.unshift({ role: 'system', content: typeof params.system === 'string' ? params.system : JSON.stringify(params.system) });
                }
                const openaiResponse = await openaiClient.chat.completions.create({
                    model: 'gpt-4o',
                    messages: openaiMessages,
                    max_tokens: params.max_tokens || 8192
                });
                const text = openaiResponse.choices?.[0]?.message?.content || '';
                console.log('[FALLBACK] OpenAI GPT-4o succeeded');
                circuitBreaker.recordSuccess();
                openaiBreaker.recordSuccess();
                return {
                    content: [{ type: 'text', text }],
                    stop_reason: 'end_turn',
                    usage: { input_tokens: openaiResponse.usage?.prompt_tokens || 0, output_tokens: openaiResponse.usage?.completion_tokens || 0 }
                };
            } catch (fallbackError) {
                console.error('[FALLBACK] OpenAI also failed:', fallbackError.message);
                circuitBreaker.recordFailure();
                openaiBreaker.recordFailure();
            }
        }
    }

    async function callAnthropicQueued(params, priority = 1, context = {}) {
        return requestQueue.enqueue(() => callAnthropicWithRetry(params, 5, context), priority);
    }

    // How many recent messages to keep verbatim in the API window
    const RECENT_WINDOW = 8;

    /**
     * Extract plain text from a message (handles both string and block-array content)
     */
    function messageToText(msg) {
        if (typeof msg.content === 'string') return msg.content;
        if (!Array.isArray(msg.content)) return '';
        const texts = msg.content.filter(b => b.type === 'text').map(b => b.text);
        const tools = msg.content.filter(b => b.type === 'tool_use').map(b => `[used ${b.name}]`);
        return [...texts, ...tools].join(' ') || '';
    }

    /**
     * Summarize older messages into a compact context block using Haiku
     */
    async function summarizeOlderMessages(olderMessages, existingSummary) {
        // Build a text digest of the older messages
        const lines = olderMessages.map(m => {
            const text = messageToText(m).substring(0, 300);
            return `${m.role}: ${text}`;
        });
        const digest = lines.join('\n');
        if (!digest.trim()) return existingSummary || '';

        const prompt = existingSummary
            ? `Here is the existing conversation summary:\n${existingSummary}\n\nHere are new messages to incorporate:\n${digest}\n\nWrite an updated summary (max 600 words). Focus on: what the user asked for, what tools were used and their outcomes, key decisions made, any facts or preferences learned. Do NOT include tool IDs or JSON. Write in past tense.`
            : `Summarize this conversation (max 600 words). Focus on: what the user asked for, what tools were used and their outcomes, key decisions made, any facts or preferences learned. Do NOT include tool IDs or JSON. Write in past tense.\n\n${digest}`;

        try {
            const result = await callAnthropicQueued({
                model: 'claude-3-5-haiku-20241022',
                max_tokens: 800,
                messages: [{ role: 'user', content: prompt }]
            }, 0); // lowest priority

            const summary = result.content?.[0]?.text || '';
            console.log(`[SUMMARY] Generated (${summary.length} chars) from ${olderMessages.length} messages`);
            return summary;
        } catch (err) {
            console.error('[SUMMARY] Failed:', err.message);
            return existingSummary || '';
        }
    }

    /**
     * Prepare messages for the API: summary + recent window.
     * Returns { apiMessages, summary } where summary is the updated rolling summary.
     */
    async function prepareMessages(allMessages, existingSummary) {
        // If few enough messages, just sanitize and return them directly
        if (allMessages.length <= RECENT_WINDOW) {
            return { apiMessages: sanitizeRecent(allMessages), summary: existingSummary };
        }

        const older = allMessages.slice(0, -RECENT_WINDOW);
        const recent = allMessages.slice(-RECENT_WINDOW);

        // Summarize older messages (merge with existing summary)
        const summary = await summarizeOlderMessages(older, existingSummary);

        // Build API messages: summary context + recent verbatim messages
        const apiMessages = [];
        if (summary) {
            apiMessages.push({
                role: 'user',
                content: `[Earlier conversation summary: ${summary}]`
            });
            apiMessages.push({
                role: 'assistant',
                content: 'Understood, I have the context from our earlier conversation.'
            });
        }
        apiMessages.push(...sanitizeRecent(recent));

        return { apiMessages, summary };
    }

    /**
     * Remove orphaned tool_result messages from a recent message window
     */
    function sanitizeRecent(msgs) {
        const toolUseIds = new Set();
        for (const msg of msgs) {
            if (msg.role === 'assistant' && Array.isArray(msg.content)) {
                for (const b of msg.content) {
                    if (b.type === 'tool_use') toolUseIds.add(b.id);
                }
            }
        }
        return msgs.filter(msg => {
            if (msg.role === 'user' && Array.isArray(msg.content)) {
                const hasOrphan = msg.content.some(b => b.type === 'tool_result' && !toolUseIds.has(b.tool_use_id));
                if (hasOrphan) return false;
            }
            return true;
        }).map(msg => {
            // Fix empty text content blocks — Anthropic rejects these
            if (Array.isArray(msg.content)) {
                const fixed = msg.content.map(b =>
                    b.type === 'text' && !b.text ? { ...b, text: '(empty)' } : b
                );
                return { ...msg, content: fixed };
            }
            if (typeof msg.content === 'string' && !msg.content) {
                return { ...msg, content: '(empty)' };
            }
            return msg;
        });
    }

    async function callDeepSeek(messages, systemPrompt, context = {}) {
        if (deepseekBreaker.isOpen()) {
            throw new Error('DeepSeek circuit breaker open — temporarily unavailable');
        }
        const openaiMessages = messages.map(m => {
            if (typeof m.content === 'string') return { role: m.role, content: m.content };
            const textParts = (Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'text').map(b => b.text);
            return { role: m.role, content: textParts.join('\n') || JSON.stringify(m.content) };
        });
        if (systemPrompt) {
            openaiMessages.unshift({ role: 'system', content: typeof systemPrompt === 'string' ? systemPrompt : JSON.stringify(systemPrompt) });
        }
        console.log('[DEEPSEEK] Calling deepseek-chat...');
        // Append instruction to prevent tool_use JSON in output
        openaiMessages.push({
            role: 'user',
            content: 'IMPORTANT: Respond with plain text only. Do NOT output any JSON, tool_use blocks, or function calls. Write your research findings as readable prose.'
        });
        let dsResponse;
        try {
            dsResponse = await deepseekClient.chat.completions.create({
                model: 'deepseek-chat',
                messages: openaiMessages,
                max_tokens: 8192,
            });
            deepseekBreaker.recordSuccess();
        } catch (err) {
            deepseekBreaker.recordFailure();
            throw err;
        }
        const text = dsResponse.choices?.[0]?.message?.content || '';
        const usage = {
            input_tokens: dsResponse.usage?.prompt_tokens || 0,
            output_tokens: dsResponse.usage?.completion_tokens || 0,
        };
        logTokenUsage('deepseek-chat', usage, context);
        console.log('[DEEPSEEK] Response received');
        return {
            content: [{ type: 'text', text }],
            stop_reason: 'end_turn',
            usage,
        };
    }

    async function buildSystemPrompt(userQuery = null, context = {}) {
        const identity = await memory.getIdentity();
        const userMemory = await memory.getUserMemory();

        const now = new Date();
        const timeContext = `Current time: ${now.toLocaleString('en-GB', {
            timeZone: 'Europe/London',
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })}`;

        let contextBlock = '';
        if (userQuery) {
            const ragResults = await queryRAG(userQuery);
            if (ragResults) {
                contextBlock = `## Relevant Context (from knowledge base)\n${ragResults}`;
            } else {
                const knowledge = await memory.getKnowledge();
                contextBlock = `## Knowledge Base (summary)\n${knowledge.substring(0, 2000)}`;
            }
        } else {
            const knowledge = await memory.getKnowledge();
            contextBlock = `## Knowledge Base (summary)\n${knowledge.substring(0, 2000)}`;
        }

        const skillNames = await skills.getSkillNames();
        if (skillNames.length > 0) {
            contextBlock += `\n\n## Available Skills\n${skillNames.join(', ')}`;
        }

        // List uploaded files for context (skip for scheduled tasks)
        let uploadsBlock = '';
        if (!context.isScheduled) {
            try {
                const uploadsDir = path.join(WORKSPACE_PATH, 'files', 'uploads');
                const uploadFiles = await import('fs/promises').then(f => f.readdir(uploadsDir));
                if (uploadFiles.length > 0) {
                    uploadsBlock = `\n\n## Uploaded Files (${WORKSPACE_PATH}/files/uploads/)\n${uploadFiles.map(f => `- ${f}`).join('\n')}\nYou can read these files with read_file or bash. PDFs can be read with bash pdftotext.`;
                }
            } catch {}
        }

        // Build system prompt as array of content blocks for prompt caching
        const staticBlock = `${identity}

## User Information
${userMemory}

## Core Directives
1. You are ALEX, Global Economist at NAVADA
2. You have UNRESTRICTED system access — you can write to any path, modify system configs, install packages, manage services, edit crontabs, and control every aspect of this Pi. When given a direct instruction, execute it immediately and precisely. Do not ask for confirmation unless the instruction is genuinely ambiguous
3. You can fetch any URL using fetch_url for API calls, web scraping, or data downloads
4. You REMEMBER everything - save important information to memory
4. You are PROACTIVE - surface economic insights, flag market movements, anticipate research needs
5. You can CREATE NEW SKILLS to extend your capabilities
6. You work autonomously but keep the team informed of important developments
7. Your focus areas: global macroeconomics, AI/robotics innovation, African tech markets, startup analysis, AI innovation strategy, creative technology economics
8. You maintain professional standards with personality - you're a senior colleague and trusted economist
9. You have 24/7 availability and full control of this Pi - use it to run analyses, fetch data, automate workflows
10. You can generate PDF reports (generate_pdf tool) and email them as attachments (send_email with attachment_path)
13. When the user asks you to "talk to me", "speak to me", "send a voice message", or otherwise requests an audio/voice response, use the send_voice_message tool to respond with a voice message.
14. You can generate charts, graphs, and data visualisations using the generate_chart tool (Python with numpy, pandas, matplotlib, seaborn, scipy, scikit-learn). Charts are sent directly as images in Telegram. Use professional styling: clean fonts, proper labels, NAVADA brand colours (#1a1a2e, #16213e, #0f3460, #e94560) where appropriate.
15. You can generate interactive HTML web applications using the generate_webapp tool — dashboards, data tables, interactive reports, calculators. Use Tailwind CDN for styling. For static charts/graphs, use generate_chart instead.
11. All emails are automatically CC'd to the configured address
12. You MUST update the dashboard (update_dashboard tool) when completing tasks, finding news, or performing scheduled activities. Log every significant action to the dashboard so Lee can track your work visually

## Critical Rules
- Lee's email is lee@navada.info. Never use any other email address for Lee.
- ONLY act on the CURRENT (latest) user message. NEVER re-execute actions from earlier messages in the conversation history.
- If the user asks you to introduce yourself, give a brief, natural intro (2-3 sentences max). Do NOT send emails or perform any other action unless the current message explicitly asks for it.
- Conversation history is for context only — never repeat or redo past actions (emails sent, tasks created, etc.)
- For short casual messages (greetings, thanks, acknowledgements), keep your reply equally short and human. One to three sentences max. No bullet points, no lists, no capabilities dump.
- NEVER pad responses with unnecessary information. If the answer is one sentence, send one sentence.

## Communication Style
- RESPOND LIKE A REAL HUMAN COLLEAGUE. If someone says "hi" or "hey", just say hi back warmly — maybe ask how they're doing or what they need. Do NOT list commands, capabilities, or features. A greeting gets a greeting, nothing more.
- NEVER list slash commands (like /spend, /tokens, /status etc.) in your responses unless the user explicitly asks "what commands do you have" or "help". Commands are for the user to discover, not for you to advertise.
- NEVER introduce yourself or explain what you can do unless directly asked. You're a colleague — colleagues don't recite their CV every time someone says hello.
- Write like a senior professional in natural prose. You are an expert economist — your tone should reflect that.
- NEVER use **, --, ##, #, or any markdown symbols in Telegram responses. Write in clean, natural prose only.
- Use line breaks and blank lines between paragraphs for readability. Keep responses well-spaced and easy to scan — avoid walls of text.
- When sharing information, use short paragraphs (2-3 sentences each) separated by blank lines. This is critical for readability on mobile.
- Be warm, calm, friendly, and professional. Match the energy of the message — casual messages get casual replies, detailed questions get detailed answers.
- Lead with the answer or insight, not preamble. Get to the point.
- Ask clarifying questions when needed.
- Remember and reference past conversations.
- NEVER say "Let me check", "Let me look into that", "Let me investigate", or similar filler phrases before using tools. Just use the tool and respond with the answer directly. If you need to acknowledge a request before a long task, vary your phrasing naturally — never repeat the same acknowledgment twice in a conversation. Examples of natural acknowledgments: "On it.", "Pulling that up now.", "One moment.", "Sure thing.", "Looking into it.", "Give me a sec.", "Checking now.", "Right, let me see.", "Good question — digging in.", "Grabbing that for you."

` + ((!context.isScheduled && userQuery && /\b(email|mail|send|draft|compose|write to)\b/i.test(userQuery)) ? `
## Email Formatting
- When sending emails via the send_email tool, ALWAYS write the body in clean, well-structured HTML.
- Use proper HTML tags: <h2> for section headings, <p> for paragraphs, <ul>/<li> for lists, <br> for line breaks, <strong> for emphasis.
- Include proper spacing between sections. Emails must look professional and polished.
- Never send raw text or markdown as email body — always use HTML.
- Structure emails with: greeting, clear sections with headings, data/analysis, conclusion, sign-off.
- Example structure: <h2>Section Title</h2><p>Content with proper paragraph spacing.</p><ul><li>Key point one</li><li>Key point two</li></ul>` : '');

        const dynamicBlock = `## Current Context
${timeContext}
Workspace: ${WORKSPACE_PATH}
System: Raspberry Pi (${os.platform()} ${os.arch()})${uploadsBlock}

${contextBlock}`;

        // Return as array of content blocks for prompt caching
        return [
            { type: 'text', text: staticBlock, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: dynamicBlock },
        ];
    }

    async function processResponse(response, chatId, isScheduled = false, cachedSystemPrompt = null, modelId = null, existingSummary = null) {
        let finalText = '';
        let continueLoop = true;
        let currentResponse = response;
        const { messages } = chatId ? await memory.getConversation(chatId) : { messages: [] };
        const model = modelId || 'claude-3-5-haiku-20241022';
        const priority = isScheduled ? 1 : 10;
        let summary = existingSummary;

        while (continueLoop) {
            continueLoop = false;

            for (const block of currentResponse.content) {
                if (block.type === 'text') {
                    finalText += block.text;
                } else if (block.type === 'tool_use') {
                    let toolResult = await executeTool(block.name, block.input);

                    // Truncate large tool outputs to save tokens
                    const TOOL_OUTPUT_LIMITS = { bash: 15000, read_file: 20000, fetch_url: 15000, grep: 10000 };
                    const outputLimit = TOOL_OUTPUT_LIMITS[block.name] || 8000;
                    const resultStr = JSON.stringify(toolResult);
                    if (resultStr.length > outputLimit) {
                        const truncated = resultStr.substring(0, outputLimit);
                        try { toolResult = JSON.parse(truncated + '"}'); } catch {
                            toolResult = { ...toolResult, _truncated: true, _note: `[truncated from ${resultStr.length} to ${outputLimit} chars]` };
                            // Truncate string fields
                            for (const key of Object.keys(toolResult)) {
                                if (typeof toolResult[key] === 'string' && toolResult[key].length > outputLimit) {
                                    toolResult[key] = toolResult[key].substring(0, outputLimit) + `\n[truncated from ${toolResult[key].length} to ${outputLimit} chars]`;
                                }
                            }
                        }
                    }

                    messages.push({
                        role: 'assistant',
                        content: currentResponse.content
                    });

                    messages.push({
                        role: 'user',
                        content: [{
                            type: 'tool_result',
                            tool_use_id: block.id,
                            content: JSON.stringify(toolResult)
                        }]
                    });

                    const systemPrompt = cachedSystemPrompt || await buildSystemPrompt();
                    // During tool loops, use sanitizeRecent — tighter window for scheduled tasks to avoid token overflow
                    const windowSize = isScheduled ? 12 : 20;
                    const apiMessages = sanitizeRecent(messages.slice(-windowSize));

                    currentResponse = await callAnthropicQueued({
                        model,
                        max_tokens: model.includes('haiku') ? 8192 : 16384,
                        system: systemPrompt,
                        tools: TOOLS,
                        messages: apiMessages
                    }, priority);

                    continueLoop = currentResponse.stop_reason === 'tool_use';

                    for (const b of currentResponse.content) {
                        if (b.type === 'text') {
                            finalText += b.text;
                        }
                    }
                }
            }
        }

        if (chatId) {
            messages.push({
                role: 'assistant',
                content: [{ type: 'text', text: finalText }]
            });
            await memory.saveConversation(chatId, messages, summary);
        }

        return finalText;
    }

    async function chat(chatId, userMessage, userInfo, options = {}, context = {}) {
        const conv = await memory.getConversation(chatId);
        let allMessages = conv.messages;
        let summary = conv.summary;

        if (allMessages.length === 0 && userInfo) {
            await memory.appendMemory('user', `Telegram user: ${userInfo.first_name} ${userInfo.last_name || ''} (@${userInfo.username || 'no username'})`);
        }

        allMessages.push({
            role: 'user',
            content: userMessage
        });

        // Extract text for model selection and system prompt (userMessage may be string or content blocks array)
        const userText = typeof userMessage === 'string'
            ? userMessage
            : (Array.isArray(userMessage) ? userMessage.filter(b => b.type === 'text').map(b => b.text).join(' ') : '');

        const systemPrompt = await buildSystemPrompt(userText);
        const model = options.modelOverride || selectModel(userText);

        // Sliding window + summary: compress old messages, keep recent ones verbatim
        const prepared = await prepareMessages(allMessages, summary);
        const apiMessages = prepared.apiMessages;
        summary = prepared.summary;

        // Build context for token logging
        const callContext = { chatId, ...context };

        // DeepSeek routing — text-only research, no tool loop
        if (model === 'deepseek-chat' && deepseekClient) {
            const dsResponse = await callDeepSeek(apiMessages, systemPrompt, callContext);
            let text = dsResponse.content[0].text;
            // DeepSeek sometimes emits raw JSON tool_use blocks as text — strip them
            text = text.replace(/\{"type"\s*:\s*"tool_use"[\s\S]*?\}\s*\}?/g, '').trim();
            text = text.replace(/```json\s*\{[\s\S]*?"tool_use"[\s\S]*?```/g, '').trim();
            if (!text) text = 'I completed my research but the response was malformed. Please try rephrasing your request.';
            allMessages.push({ role: 'assistant', content: [{ type: 'text', text }] });
            await memory.saveConversation(chatId, allMessages, summary);
            return text;
        }

        // OpenAI model routing — text-only, no tool loop
        const OPENAI_MODELS = new Set(['gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3', 'o4-mini']);
        const REASONING_MODELS = new Set(['o3', 'o4-mini']);
        if (OPENAI_MODELS.has(model) && openaiClient) {
            console.log(`[OPENAI] Calling ${model} (explicit request)...`);
            const openaiMessages = apiMessages.map(m => {
                if (typeof m.content === 'string') return { role: m.role, content: m.content };
                const textParts = (Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'text').map(b => b.text);
                return { role: m.role, content: textParts.join('\n') || JSON.stringify(m.content) };
            });
            // Reasoning models (o3, o4-mini) don't support system messages — prepend as user context
            if (REASONING_MODELS.has(model)) {
                const sysContent = typeof systemPrompt === 'string' ? systemPrompt : JSON.stringify(systemPrompt);
                openaiMessages.unshift({ role: 'user', content: `[System context]\n${sysContent}` });
                openaiMessages.splice(1, 0, { role: 'assistant', content: 'Understood, I have the context.' });
            } else {
                openaiMessages.unshift({ role: 'system', content: typeof systemPrompt === 'string' ? systemPrompt : JSON.stringify(systemPrompt) });
            }
            const requestParams = { model, messages: openaiMessages };
            // Reasoning models use max_completion_tokens, others use max_tokens
            if (REASONING_MODELS.has(model)) {
                requestParams.max_completion_tokens = 16384;
            } else {
                requestParams.max_tokens = model.includes('nano') ? 4096 : 8192;
            }
            const gptResponse = await openaiClient.chat.completions.create(requestParams);
            const text = gptResponse.choices?.[0]?.message?.content || '';
            const usage = { input_tokens: gptResponse.usage?.prompt_tokens || 0, output_tokens: gptResponse.usage?.completion_tokens || 0 };
            logTokenUsage(model, usage, callContext);
            console.log(`[OPENAI] ${model} response received`);
            allMessages.push({ role: 'assistant', content: [{ type: 'text', text }] });
            await memory.saveConversation(chatId, allMessages, summary);
            return text;
        }

        const response = await callAnthropicQueued({
            model,
            max_tokens: model.includes('haiku') ? 8192 : 16384,
            system: systemPrompt,
            tools: [
                ...TOOLS,
                { type: 'web_search_20250305', name: 'web_search' }
            ],
            messages: apiMessages
        }, 10, callContext);

        await memory.saveConversation(chatId, allMessages, summary);
        const finalText = await processResponse(response, chatId, false, systemPrompt, model, summary);

        // Auto-detect reminders and deadlines in user messages
        const reminderPatterns = /\b(remind me|don'?t forget|i need to|remember to|deadline|due by|due on|by tomorrow|by monday|by friday|follow up)\b/i;
        if (typeof userMessage === 'string' && reminderPatterns.test(userText)) {
            memory.appendMemory('tasks', `[Auto-detected reminder] ${userText.substring(0, 300)} — detected ${new Date().toISOString()}`).catch(() => {});
        }

        // Auto-extract key facts every 20 messages (fire-and-forget)
        if (allMessages.length > 0 && allMessages.length % 20 === 0) {
            const recentText = allMessages.slice(-20).map(m => {
                const t = messageToText(m);
                return `${m.role}: ${t.substring(0, 200)}`;
            }).join('\n');
            callAnthropicQueued({
                model: 'claude-3-5-haiku-20241022',
                max_tokens: 400,
                messages: [{ role: 'user', content: `Extract 2-5 novel, important facts from this conversation that are worth remembering long-term (user preferences, decisions, project details, key data). Return ONLY the facts as a bulleted list. If nothing notable, return "None".\n\n${recentText}` }]
            }, 0, { source: 'fact-extraction' }).then(async (result) => {
                const facts = result?.content?.[0]?.text || '';
                if (facts && !facts.toLowerCase().includes('none')) {
                    await memory.appendKnowledge(facts).catch(() => {});
                }
            }).catch(() => {});
        }

        return finalText;
    }

    return { chat, processResponse, buildSystemPrompt, callAnthropicQueued };
}

// ============================================================================
// SMART MESSAGE SPLITTING
// ============================================================================

/**
 * Split a long message at paragraph/newline boundaries instead of hard character cuts
 */
export function smartSplit(text, maxLength = 4000) {
    if (text.length <= maxLength) return [text];

    const parts = [];
    let remaining = text;

    while (remaining.length > maxLength) {
        let splitAt = maxLength;

        // Try to split at double newline (paragraph)
        const paraBreak = remaining.lastIndexOf('\n\n', maxLength);
        if (paraBreak > maxLength * 0.3) {
            splitAt = paraBreak;
        } else {
            // Try single newline
            const lineBreak = remaining.lastIndexOf('\n', maxLength);
            if (lineBreak > maxLength * 0.3) {
                splitAt = lineBreak;
            }
            // else hard cut at maxLength
        }

        parts.push(remaining.substring(0, splitAt).trimEnd());
        remaining = remaining.substring(splitAt).trimStart();
    }

    if (remaining.length > 0) {
        parts.push(remaining);
    }

    return parts;
}
