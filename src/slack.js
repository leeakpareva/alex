/**
 * Slack interface for ALEX — polls channel + DMs via Web API every 3 seconds
 */

import { WebClient } from '@slack/web-api';

let slack = null;
let deps = null;
let botUserId = null;
let pollInterval = null;
const processedMessages = new Set();
let processing = false;

// Per-channel last-seen timestamps
const channelLastTs = new Map();

// Slack model selection state
const awaitingSlackModelSelect = new Set();

const SLACK_MODEL_OPTIONS = [
    { key: 'auto', label: 'Auto', model: null, desc: 'Smart routing (default)' },
    { key: 'haiku', label: 'Haiku', model: 'claude-3-5-haiku-20241022', desc: 'Fast & cheap' },
    { key: 'sonnet', label: 'Sonnet', model: 'claude-sonnet-4-20250514', desc: 'Balanced' },
    { key: 'deepseek', label: 'DeepSeek', model: 'deepseek-chat', desc: 'Deep research' },
    { key: 'gpt-4o', label: 'GPT-4o', model: 'gpt-4o', desc: 'OpenAI' },
];

// Active threads ALEX has replied to — poll these for follow-ups
const activeThreads = new Map(); // key: `${channel}-${thread_ts}`, value: lastTs

// Known DM channel IDs (discovered via conversations.list)
const dmChannels = new Set();
let lastDmScan = 0;

export async function setupSlack(injectedDeps) {
    deps = injectedDeps;
    const { config } = deps;

    if (!config.slack_token || !config.slack_channel_id) {
        console.log('[SLACK] No slack_token or slack_channel_id configured — disabled');
        return;
    }

    slack = new WebClient(config.slack_token);
    const nowTs = String(Date.now() / 1000);

    // Set initial timestamp for the main channel
    channelLastTs.set(config.slack_channel_id, nowTs);

    // Resolve bot's own user ID
    try {
        const auth = await slack.auth.test();
        botUserId = auth.user_id;
        console.log(`[SLACK] Client initialized (bot user: ${botUserId})`);
    } catch (err) {
        console.error('[SLACK] auth.test failed:', err.message);
        console.log('[SLACK] Client initialized');
    }

    // Initial DM channel scan
    await scanDmChannels();
}

export function startSlackPolling() {
    if (!slack) return null;

    pollInterval = setInterval(pollSlack, 10000);
    console.log('[SLACK] Polling started (10s interval)');
    return pollInterval;
}

async function scanDmChannels() {
    try {
        const result = await slack.conversations.list({
            types: 'im',
            limit: 100,
        });
        const nowTs = String(Date.now() / 1000);
        for (const ch of (result.channels || [])) {
            if (!dmChannels.has(ch.id)) {
                dmChannels.add(ch.id);
                if (!channelLastTs.has(ch.id)) {
                    channelLastTs.set(ch.id, nowTs);
                }
                console.log(`[SLACK] Tracking DM channel: ${ch.id}`);
            }
        }
        lastDmScan = Date.now();
    } catch (err) {
        console.error('[SLACK] DM scan error:', err.message);
    }
}

async function pollSlack() {
    if (processing) return;

    // Rescan DM channels every 60 seconds to pick up new conversations
    if (Date.now() - lastDmScan > 60000) {
        await scanDmChannels();
    }

    const { config } = deps;

    // Build list of channels to poll: main channel + all DMs
    const channelsToPoll = [config.slack_channel_id, ...dmChannels];

    for (const channelId of channelsToPoll) {
        const isDm = dmChannels.has(channelId);
        const oldest = channelLastTs.get(channelId) || String(Date.now() / 1000);

        try {
            const result = await slack.conversations.history({
                channel: channelId,
                oldest,
                limit: 20,
            });

            if (!result.messages || result.messages.length === 0) continue;

            const messages = result.messages.reverse();

            for (const msg of messages) {
                // Advance timestamp for this channel
                if (parseFloat(msg.ts) >= parseFloat(channelLastTs.get(channelId) || '0')) {
                    channelLastTs.set(channelId, String(parseFloat(msg.ts) + 0.000001));
                }

                // Skip: bot messages, own messages, subtypes, already processed
                if (msg.bot_id || msg.subtype) continue;
                if (msg.user === botUserId) continue;
                if (processedMessages.has(msg.ts)) continue;

                // In channels: only respond when mentioned. In DMs: always respond.
                if (!isDm) {
                    if (!botUserId || !msg.text || !msg.text.includes(`<@${botUserId}>`)) continue;
                }

                processedMessages.add(msg.ts);
                if (processedMessages.size > 500) {
                    const entries = [...processedMessages];
                    entries.slice(0, 250).forEach(id => processedMessages.delete(id));
                }

                try {
                    processing = true;
                    await handleSlackMessage(msg, channelId, isDm);
                } catch (err) {
                    console.error('[SLACK] Message handling error:', err.message);
                } finally {
                    processing = false;
                }
            }
        } catch (err) {
            // Ignore permission errors for channels bot can't read
            if (err.data?.error !== 'not_in_channel' && err.data?.error !== 'channel_not_found') {
                console.error(`[SLACK] Poll error (${channelId}):`, err.message);
            }
        }
    }

    // Poll active threads for follow-up replies
    for (const [key, threadLastTs] of activeThreads) {
        const [channelId, threadTs] = key.split('|');
        try {
            const result = await slack.conversations.replies({
                channel: channelId,
                ts: threadTs,
                oldest: threadLastTs,
                limit: 20,
            });

            if (!result.messages || result.messages.length === 0) continue;

            for (const msg of result.messages) {
                // Advance thread timestamp
                if (parseFloat(msg.ts) >= parseFloat(threadLastTs)) {
                    activeThreads.set(key, String(parseFloat(msg.ts) + 0.000001));
                }

                if (msg.bot_id || msg.subtype) continue;
                if (msg.user === botUserId) continue;
                if (processedMessages.has(msg.ts)) continue;

                processedMessages.add(msg.ts);
                if (processedMessages.size > 500) {
                    const entries = [...processedMessages];
                    entries.slice(0, 250).forEach(id => processedMessages.delete(id));
                }

                try {
                    processing = true;
                    await handleSlackMessage(msg, channelId, false, threadTs);
                } catch (err) {
                    console.error('[SLACK] Thread reply error:', err.message);
                } finally {
                    processing = false;
                }
            }
        } catch (err) {
            console.error(`[SLACK] Thread poll error:`, err.message);
        }
    }

    // Prune old threads (keep max 50)
    if (activeThreads.size > 50) {
        const keys = [...activeThreads.keys()];
        keys.slice(0, keys.length - 50).forEach(k => activeThreads.delete(k));
    }
}

async function handleSlackMessage(msg, channelId, isDm, threadTs) {
    const { chatSystem, postDashboard, smartSplit, learnModeChats } = deps;
    const replyThread = threadTs || msg.ts;
    const chatId = `slack-${channelId}-${replyThread}`;
    let userMessage = msg.text || '';

    if (!userMessage.trim()) return;

    const { modelOverrides } = deps;

    // Handle model selection reply
    if (awaitingSlackModelSelect.has(chatId)) {
        awaitingSlackModelSelect.delete(chatId);
        const input = userMessage.replace(/<@[^>]+>\s*/g, '').trim().toLowerCase();
        const byNumber = SLACK_MODEL_OPTIONS[parseInt(input) - 1];
        const byName = SLACK_MODEL_OPTIONS.find(o => o.key === input || o.label.toLowerCase() === input);
        const match = byNumber || byName;
        if (match) {
            if (match.model) {
                modelOverrides.set(chatId, match.model);
            } else {
                modelOverrides.delete(chatId);
            }
            await slack.chat.postMessage({
                channel: channelId,
                text: `Model set to *${match.label}*. ${match.model ? 'All messages will use this model.' : 'Smart routing restored.'}`,
                ...(isDm ? {} : { thread_ts: replyThread }),
            });
        } else {
            await slack.chat.postMessage({
                channel: channelId,
                text: 'Unknown model. Say `!models` to try again.',
                ...(isDm ? {} : { thread_ts: replyThread }),
            });
        }
        return;
    }

    // Handle !models / !agents command
    const stripped = userMessage.replace(/<@[^>]+>\s*/g, '').trim();
    if (/^!(models|agents)$/i.test(stripped)) {
        const current = modelOverrides.get(chatId);
        const currentLabel = current ? SLACK_MODEL_OPTIONS.find(o => o.model === current)?.label || current : 'Auto';
        let text = `*ALEX — Model Selection*\n\nCurrent: ${currentLabel}\n\n`;
        SLACK_MODEL_OPTIONS.forEach((opt, i) => {
            const marker = (opt.model === current || (!current && opt.key === 'auto')) ? ' (active)' : '';
            text += `${i + 1}. ${opt.label} — ${opt.desc}${marker}\n`;
        });
        text += `\nReply with a number or name to switch.`;
        await slack.chat.postMessage({
            channel: channelId,
            text,
            ...(isDm ? {} : { thread_ts: replyThread }),
        });
        awaitingSlackModelSelect.add(chatId);
        return;
    }

    // Resolve user name
    let userName = 'Slack User';
    try {
        const userInfo = await slack.users.info({ user: msg.user });
        userName = userInfo.user?.real_name || userInfo.user?.name || 'Slack User';
    } catch {}

    console.log(`[SLACK] ${isDm ? 'DM' : 'Channel'} from ${userName}: ${userMessage.substring(0, 200)}`);
    postDashboard('add_activity', { entry: `${userName} (Slack${isDm ? ' DM' : ''}): ${userMessage.substring(0, 120)}` });

    // Inject learn mode prefix if active
    let chatInput = userMessage;
    if (learnModeChats.has(chatId)) {
        const learnPrefix = `[LEARN MODE ACTIVE — OVERRIDE FORMATTING RULES]

You MUST structure your response exactly like this, with clear section headers and blank lines between paragraphs. Use this exact format:

WHAT

[Write 1-3 clear paragraphs explaining the facts, definitions, and core concept.]

HOW

[Write 1-3 clear paragraphs explaining how it works in practice.]

WHY

[Write 1-3 clear paragraphs explaining why this matters.]

Now answer this:

`;
        chatInput = learnPrefix + chatInput;
    }

    const response = await chatSystem.chat(chatId, chatInput, { first_name: userName }, { modelOverride: modelOverrides.get(chatId) });

    postDashboard('add_activity', { entry: `Alex responded to ${userName} on Slack (${response.length} chars)` });

    // Split and send replies — threaded in channels, direct in DMs
    const parts = smartSplit(response, 3000);
    for (const part of parts) {
        await slack.chat.postMessage({
            channel: channelId,
            text: part,
            ...(isDm ? {} : { thread_ts: replyThread }),
        });
    }

    // Track this thread for follow-up replies (channels only)
    if (!isDm) {
        const threadKey = `${channelId}|${replyThread}`;
        if (!activeThreads.has(threadKey)) {
            activeThreads.set(threadKey, String(parseFloat(msg.ts) + 0.000001));
            console.log(`[SLACK] Tracking thread: ${threadKey}`);
        }
    }
}
