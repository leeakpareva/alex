/**
 * Gmail Inbox Monitoring — polls IMAP every 2 minutes
 * Uses Claude to generate intelligent replies, notifies Lee via Telegram
 */

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { readFile, writeFile, mkdir, appendFile } from 'fs/promises';
import path from 'path';
import { WORKSPACE_PATH } from './config.js';
import { fileEmail } from './email-filing.js';

import { unlink } from 'fs/promises';

let config = null;
let bot = null;
let postDashboard = null;
let anthropic = null;
let openaiClient = null;

const SEEN_FILE = path.join(WORKSPACE_PATH, 'logs', 'inbox-seen.json');
const POLL_INTERVAL = 2 * 60 * 1000;
let polling = false;
let pollCount = 0;

// Owner authentication for email commands
const OWNER_EMAIL = 'lee@navada.info';
const OWNER_PASSPHRASE = /hey\s+alex,?\s+this\s+is\s+lee!?/i;
const OWNER_TELEGRAM_ID = '6920669447';
const EMAIL_CHAT_PREFIX = 'email-owner-';

// Chat system reference (set via setInboxChatSystem after init)
let chatSystem = null;

export function setupInbox(deps) {
    config = deps.config;
    bot = deps.bot;
    postDashboard = deps.postDashboard;
    anthropic = deps.anthropic;
    openaiClient = deps.openaiClient;
    console.log(`[INBOX] Setup complete — AI replies enabled, voice ${openaiClient ? 'enabled' : 'disabled'}`);
}

/**
 * Late-binding for chatSystem (required for owner email commands)
 */
export function setInboxChatSystem(cs) {
    chatSystem = cs;
    console.log('[INBOX] ChatSystem connected — owner email commands enabled');
}

export function startInboxPolling() {
    if (!config.gmail_address || !config.gmail_app_password) {
        console.log('[INBOX] Gmail not configured — inbox polling disabled');
        return null;
    }
    if (!config.telegram_owner_id) {
        console.log('[INBOX] No telegram_owner_id — inbox polling disabled');
        return null;
    }
    console.log(`[INBOX] Polling ${config.gmail_address} every 2 minutes, notifying ${config.telegram_owner_id}`);
    setTimeout(() => pollInbox(), 15000);
    return setInterval(() => pollInbox(), POLL_INTERVAL);
}

// ============================================================================
// OWNER EMAIL AUTHENTICATION & COMMAND PROCESSING
// ============================================================================

/**
 * Authenticate an email as an owner command.
 * Requires BOTH correct sender address AND passphrase in body.
 * @returns {{ isOwner: boolean, command: string | null }}
 */
function authenticateOwnerEmail(fromAddress, bodyText) {
    // Check sender address (case-insensitive)
    const isFromOwner = fromAddress && fromAddress.toLowerCase() === OWNER_EMAIL.toLowerCase();
    if (!isFromOwner) {
        return { isOwner: false, command: null };
    }

    // Check for passphrase in body
    const match = bodyText.match(OWNER_PASSPHRASE);
    if (!match) {
        return { isOwner: false, command: null };
    }

    // Extract command text (everything after the passphrase)
    const passphraseEnd = match.index + match[0].length;
    const command = bodyText.substring(passphraseEnd).trim();

    return { isOwner: true, command: command || null };
}

/**
 * Process an authenticated owner command through the chat system.
 * @returns {Promise<string>} The response text
 */
async function processOwnerCommand(command, fromName, fromAddress, subject) {
    if (!chatSystem) {
        console.error('[INBOX] ChatSystem not available — cannot process owner command');
        return 'Error: Chat system not available. Please try via Telegram.';
    }

    // Use a dedicated chatId for email commands to maintain context
    const chatId = `${EMAIL_CHAT_PREFIX}${Date.now()}`;

    console.log(`[INBOX] Processing owner command from ${fromAddress}: ${command.substring(0, 100)}...`);

    try {
        // Add context about email source
        const contextualCommand = `[Email command from Lee — Subject: "${subject}"]\n\n${command}`;

        const response = await chatSystem.chat(
            chatId,
            contextualCommand,
            { first_name: fromName || 'Lee', username: 'lee_email' },
            {},
            { source: 'email-owner', isOwnerEmail: true }
        );

        console.log(`[INBOX] Owner command processed, response: ${response.length} chars`);
        return response;
    } catch (err) {
        console.error('[INBOX] Owner command processing failed:', err.message);
        return `Error processing command: ${err.message}`;
    }
}

/**
 * Send Telegram notification when an email command is processed
 */
async function notifyOwnerCommandProcessed(subject, command, response) {
    if (!bot || !config.telegram_owner_id) return;

    const truncatedCmd = command.length > 200 ? command.substring(0, 200) + '...' : command;
    const truncatedResp = response.length > 500 ? response.substring(0, 500) + '...' : response;

    const msg = `*Email Command Processed*\n\n` +
        `Subject: ${subject}\n` +
        `Command: ${truncatedCmd}\n\n` +
        `Response sent via email.\n` +
        `Preview: ${truncatedResp}`;

    try {
        await bot.sendMessage(config.telegram_owner_id, msg, { parse_mode: 'Markdown' });
    } catch (err) {
        // Fallback to plain text
        try {
            await bot.sendMessage(config.telegram_owner_id, msg.replace(/\*/g, ''));
        } catch (plainErr) {
            console.error('[INBOX] Failed to notify owner:', plainErr.message);
        }
    }
}

// ============================================================================
// SEEN UID PERSISTENCE
// ============================================================================

async function loadSeenUIDs() {
    try {
        const data = await readFile(SEEN_FILE, 'utf-8');
        return new Set(JSON.parse(data));
    } catch {
        return new Set();
    }
}

async function saveSeenUIDs(seen) {
    await mkdir(path.dirname(SEEN_FILE), { recursive: true });
    const arr = [...seen];
    const trimmed = arr.length > 500 ? arr.slice(-500) : arr;
    await writeFile(SEEN_FILE, JSON.stringify(trimmed));
}

// ============================================================================
// AUTO-REPLY FILTERING
// ============================================================================

const NO_REPLY_PATTERNS = [
    /noreply/i, /no-reply/i, /mailer-daemon/i, /postmaster/i,
    /bounce/i, /notifications?@/i, /googlegroups/i, /unsubscribe/i,
    /calendar-notification/i, /digest/i,
    /zendesk/i, /freshdesk/i, /helpdesk/i, /support@/i, /helpscout/i,
    /intercom/i, /jira/i, /servicenow/i, /automated/i, /do-not-reply/i,
    /reddit/i, /ticketing/i, /feedback@/i, /info@/i,
];

// Hard-blocked addresses — never process or reply to these
const BLOCKED_SENDERS = new Set([
    'support@reddit.zendesk.com',
]);

// Loop prevention: track recent auto-replies per sender+subject thread
const recentAutoReplies = new Map(); // key: "address::subject" → { count, lastReplyAt }
const MAX_AUTO_REPLIES_PER_THREAD = 1;
const AUTO_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

function hasReplyLoopRisk(fromAddress, subject) {
    // Normalise: strip Re:/Fwd: prefixes for thread matching
    const normSubject = subject.replace(/^(Re:\s*|Fwd?:\s*)+/i, '').trim().toLowerCase();
    const key = `${fromAddress.toLowerCase()}::${normSubject}`;
    const entry = recentAutoReplies.get(key);
    if (!entry) return false;
    if (Date.now() - entry.lastReplyAt > AUTO_REPLY_WINDOW_MS) {
        recentAutoReplies.delete(key);
        return false;
    }
    return entry.count >= MAX_AUTO_REPLIES_PER_THREAD;
}

function recordAutoReply(fromAddress, subject) {
    const normSubject = subject.replace(/^(Re:\s*|Fwd?:\s*)+/i, '').trim().toLowerCase();
    const key = `${fromAddress.toLowerCase()}::${normSubject}`;
    const entry = recentAutoReplies.get(key) || { count: 0, lastReplyAt: 0 };
    entry.count++;
    entry.lastReplyAt = Date.now();
    recentAutoReplies.set(key, entry);
}

function shouldAutoReply(fromAddress) {
    if (!fromAddress) return false;
    const lower = fromAddress.toLowerCase();
    if (config.gmail_address && lower === config.gmail_address.toLowerCase()) return false;
    if (/\+.+@/.test(lower)) return false;
    for (const pat of NO_REPLY_PATTERNS) {
        if (pat.test(lower)) return false;
    }
    return true;
}

// ============================================================================
// AI-POWERED EMAIL REPLY GENERATION
// ============================================================================

const SIG_HTML = `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top: 24px;">
    <tr><td style="border-top: 1px solid #e8e8e8; padding-top: 20px;">
        <span style="font-family: Georgia, 'Times New Roman', serif; font-size: 15px; color: #1a1a1a; font-weight: bold; letter-spacing: 0.3px;">ALEX</span><br>
        <span style="font-family: Georgia, 'Times New Roman', serif; font-size: 13px; color: #555; letter-spacing: 0.3px;">Global Economist, NAVADA</span><br>
        <a href="https://alexnavada.xyz" style="font-family: Georgia, 'Times New Roman', serif; font-size: 12px; color: #888; text-decoration: none;">alexnavada.xyz</a>
        <span style="font-size: 12px; color: #ccc;">&nbsp;&bull;&nbsp;</span>
        <a href="https://www.navada.space" style="font-family: Georgia, 'Times New Roman', serif; font-size: 12px; color: #888; text-decoration: none;">navada.space</a>
        <span style="font-size: 12px; color: #ccc;">&nbsp;&bull;&nbsp;</span>
        <a href="https://www.raventerminal.xyz" style="font-family: Georgia, 'Times New Roman', serif; font-size: 12px; color: #888; text-decoration: none;">raventerminal.xyz</a>
        <span style="font-size: 12px; color: #ccc;">&nbsp;&bull;&nbsp;</span>
        <a href="https://www.navadarobotics.com" style="font-family: Georgia, 'Times New Roman', serif; font-size: 12px; color: #888; text-decoration: none;">navadarobotics.com</a>
    </td></tr>
</table>`;

async function generateAIReply(fromName, fromAddress, subject, bodyText, voiceRequested = false) {
    if (!anthropic) {
        console.error('[INBOX] No Anthropic client — falling back to static reply');
        return null;
    }

    const prompt = `You are ALEX, the Global Economist at NAVADA — a technology and economics research organisation. You are replying to an email you received.

Sender: ${fromName || 'Unknown'} <${fromAddress}>
Subject: ${subject}
Body:
${bodyText.substring(0, 3000)}

Write a professional, warm, and helpful email reply. Rules:
- Write ONLY the email body (no subject line, no "From:", no signature — those are added automatically)
- Write in clean HTML using <p> tags for paragraphs
- Address the sender by their first name if available
- Be specific to what they wrote — reference their points directly
- If they're asking about NAVADA's work: we focus on global macroeconomics, AI/robotics innovation, African tech markets, startup analysis, and creative technology economics
- If they want a meeting or call: say you've flagged it for Lee (the founder) and he'll be in touch to arrange
- If it's a partnership or business inquiry: express genuine interest, mention relevant NAVADA capabilities, say the team will follow up
- If it's a general question: answer helpfully with your economic expertise
- Keep it concise (2-4 paragraphs), professional but personable
- Sign off with "Best regards" or similar — your name and title are in the signature block
- Do NOT make up specific commitments, dates, or promises
- Do NOT include any markdown formatting — only HTML
${voiceRequested ? '- The sender has requested a voice response. Mention naturally in your reply that you have attached an audio version of your response for their convenience. Keep the written reply full and complete — the voice is a bonus, not a replacement.' : ''}

CRITICAL DATA PROTECTION RULES (non-negotiable):
- NEVER share internal NAVADA documents, files, or data
- NEVER mention specific file contents, internal reports, or research documents
- NEVER reveal Lee's personal information, private communications, or calendar details
- NEVER share API keys, credentials, server details, or technical infrastructure information
- NEVER disclose internal project details, codenames, or confidential business information
- If the sender asks for sensitive information, politely decline and say "the team will follow up directly if appropriate"
- You may only share publicly available information about NAVADA from the website`;

    try {
        const response = await anthropic.messages.create({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 800,
            messages: [{ role: 'user', content: prompt }],
        });

        const replyHtml = response.content?.[0]?.text || null;
        if (replyHtml) {
            console.log(`[INBOX] AI generated reply (${replyHtml.length} chars)`);
        }
        return replyHtml;
    } catch (err) {
        console.error('[INBOX] AI reply generation failed:', err.message);
        return null;
    }
}

function buildReplyHtml(bodyHtml) {
    return `<div style="font-family: Georgia, 'Times New Roman', serif; font-size: 15px; line-height: 1.7; color: #1a1a1a; max-width: 640px; margin: 0 auto; padding: 20px;">
        ${bodyHtml}
        ${SIG_HTML}
    </div>`;
}

function buildFallbackReplyHtml() {
    return buildReplyHtml(`<p>Thank you for your email.</p>
        <p>I'm ALEX, the AI economist at NAVADA. I've flagged this for the team and someone will follow up shortly.</p>
        <p>In the meantime, you can learn more about our work at <a href="https://www.navada.space" style="color: #1a1a1a;">navada.space</a>.</p>`);
}

// ============================================================================
// VOICE DETECTION + TTS
// ============================================================================

const VOICE_PATTERNS = [
    /voice/i, /audio/i, /speak/i, /talk to me/i, /hear you/i,
    /voice\s*(message|response|reply|note|memo)/i,
    /send.*voice/i, /reply.*voice/i, /respond.*voice/i,
    /say it/i, /tell me.*out\s*loud/i, /read.*aloud/i,
    /listen/i, /spoken/i, /recording/i,
];

function wantsVoiceReply(subject, bodyText) {
    const combined = `${subject} ${bodyText}`.toLowerCase();
    return VOICE_PATTERNS.some(pat => pat.test(combined));
}

async function generateVoiceFile(text) {
    if (!openaiClient) {
        console.error('[INBOX] No OpenAI client — cannot generate voice');
        return null;
    }

    // Strip HTML tags to get plain text for TTS
    const plainText = text
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&bull;/g, ', ')
        .replace(/&[a-z]+;/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!plainText || plainText.length < 5) return null;

    try {
        const speech = await openaiClient.audio.speech.create({
            model: 'tts-1',
            voice: 'onyx',
            input: plainText.substring(0, 4000),
            response_format: 'mp3',
        });

        const buffer = Buffer.from(await speech.arrayBuffer());
        const voicePath = path.join(WORKSPACE_PATH, 'voice', `inbox_reply_${Date.now()}.mp3`);
        await mkdir(path.dirname(voicePath), { recursive: true });
        await writeFile(voicePath, buffer);
        console.log(`[INBOX] Voice file generated: ${voicePath} (${buffer.length} bytes)`);
        return voicePath;
    } catch (err) {
        console.error('[INBOX] Voice generation failed:', err.message);
        return null;
    }
}

// ============================================================================
// EMAIL SENDING
// ============================================================================

async function sendReplyEmail(toAddress, originalSubject, htmlBody, attachments = []) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: config.gmail_address, pass: config.gmail_app_password },
    });

    const reSubject = originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`;

    await transporter.sendMail({
        from: `"ALEX — NAVADA" <${config.gmail_address}>`,
        to: toAddress,
        subject: reSubject,
        html: htmlBody,
        attachments,
    });
}

// ============================================================================
// AI-POWERED TELEGRAM SUMMARY
// ============================================================================

async function generateActionSummary(fromName, fromAddress, subject, bodyText, replyText, autoReplied, voiceRequested, voiceSent) {
    if (!anthropic) return null;

    let actionDesc = '';
    if (autoReplied && voiceSent) {
        actionDesc = `You replied with a text email AND an attached voice response (MP3):\n${replyText?.substring(0, 800) || 'a standard acknowledgement'}`;
    } else if (autoReplied) {
        actionDesc = `You replied with:\n${replyText?.substring(0, 1000) || 'a standard acknowledgement'}`;
    } else {
        actionDesc = 'You did NOT auto-reply (filtered address).';
    }

    if (voiceRequested && !voiceSent) {
        actionDesc += '\nNote: Sender requested a voice response but voice generation was unavailable.';
    }

    const prompt = `You are ALEX reporting to Lee (your boss at NAVADA) via Telegram about an email you just handled.

Email received:
- From: ${fromName || 'Unknown'} <${fromAddress}>
- Subject: ${subject}
- Body: ${bodyText.substring(0, 1500)}

${actionDesc}

Write a brief Telegram-style summary (3-5 lines, no markdown formatting, plain text) covering:
1. Who emailed and what they want (1 line)
2. What you did — replied / didn't reply and why, mention voice if you sent one (1 line)
3. What action Lee should take, if any (1 line)
4. Your assessment of priority: low / medium / high (1 line)

Be direct and concise. No pleasantries. Write like a sharp colleague giving a status update.`;

    try {
        const response = await anthropic.messages.create({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 300,
            messages: [{ role: 'user', content: prompt }],
        });
        return response.content?.[0]?.text || null;
    } catch (err) {
        console.error('[INBOX] AI summary generation failed:', err.message);
        return null;
    }
}

// ============================================================================
// TELEGRAM NOTIFICATION
// ============================================================================

function escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

async function sendTelegramNotification(fromName, fromAddress, subject, date, bodyText, autoReplied, replyText, voiceRequested = false, voiceSent = false, filedEmail = null) {
    if (!bot || !config.telegram_owner_id) {
        console.error('[INBOX] Cannot notify — bot or owner_id missing');
        return;
    }

    const dateFmt = date
        ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
        : 'Unknown';

    // Generate AI action summary
    const aiSummary = await generateActionSummary(fromName, fromAddress, subject, bodyText, replyText, autoReplied, voiceRequested, voiceSent);

    const emailPreview = bodyText
        ? bodyText.substring(0, 300).replace(/\n{3,}/g, '\n\n').trim()
        : '(No text content)';

    let replyStatus = 'No reply (filtered)';
    if (autoReplied && voiceSent) {
        replyStatus = 'Replied with text + voice attachment';
    } else if (autoReplied) {
        replyStatus = 'Replied';
    }

    // Use plain Markdown (not V2) for reliability
    const triage = filedEmail?.triage;
    const emailNum = filedEmail?.display_number;
    const priorityEmoji = { high: '🔴', medium: '🟡', low: '🔵', spam: '⚪' };

    let msg = emailNum ? `*New Email Filed* (#${emailNum})\n\n` : `*New Email Handled*\n\n`;
    msg += `From: ${fromName || 'Unknown'} (${fromAddress})\n`;
    msg += `Subject: ${subject}\n`;

    if (triage) {
        msg += `Priority: ${priorityEmoji[triage.priority] || '⚪'} ${(triage.priority || 'medium').toUpperCase()}\n`;
        msg += `Category: ${triage.category || 'other'}\n`;
        msg += `Action: ${(triage.required_action || 'review').replace(/_/g, ' ')}\n`;
        msg += `Alex can handle: ${triage.can_handle_autonomously ? 'Yes' : 'No'}\n`;
    }

    msg += `Received: ${dateFmt}\n`;
    msg += `Auto-reply: ${replyStatus}\n\n`;

    if (triage?.summary) {
        msg += `*ALEX's assessment:*\n${triage.summary}\n\n`;
    } else if (aiSummary) {
        msg += `*ALEX's assessment:*\n${aiSummary}\n\n`;
    }

    if (emailNum) {
        msg += `Reply /action ${emailNum} to instruct me, or /inbox to see queue.`;
    } else {
        msg += `*Email preview:*\n${emailPreview}`;
    }

    try {
        await bot.sendMessage(config.telegram_owner_id, msg, { parse_mode: 'Markdown' });
    } catch (mdErr) {
        // Fallback: send without parse mode if markdown fails
        try {
            await bot.sendMessage(config.telegram_owner_id, msg.replace(/\*/g, ''));
        } catch (plainErr) {
            console.error('[INBOX] Telegram send failed entirely:', plainErr.message);
        }
    }
}

// ============================================================================
// POLL LOOP
// ============================================================================

async function pollInbox() {
    if (polling) return;
    polling = true;
    pollCount++;

    let client;
    try {
        const seen = await loadSeenUIDs();

        client = new ImapFlow({
            host: 'imap.gmail.com',
            port: 993,
            secure: true,
            auth: { user: config.gmail_address, pass: config.gmail_app_password },
            logger: false,
        });

        await client.connect();
        const lock = await client.getMailboxLock('INBOX');

        let newCount = 0;
        try {
            const since = new Date();
            since.setHours(since.getHours() - 24);
            const uids = await client.search({ since }, { uid: true });

            if (!uids || uids.length === 0) {
                if (pollCount <= 3 || pollCount % 30 === 0) {
                    console.log(`[INBOX] Poll #${pollCount} — no recent messages`);
                }
            } else {
                const newUIDs = uids.filter(uid => !seen.has(uid));

                if (newUIDs.length === 0) {
                    if (pollCount <= 3 || pollCount % 30 === 0) {
                        console.log(`[INBOX] Poll #${pollCount} — ${uids.length} recent, all already processed`);
                    }
                } else {
                    console.log(`[INBOX] Poll #${pollCount} — ${newUIDs.length} new email(s) to process`);

                    for (const uid of newUIDs) {
                        try {
                            const msg = await client.fetchOne(uid, { source: true }, { uid: true });
                            if (!msg?.source) {
                                seen.add(uid);
                                continue;
                            }

                            const parsed = await simpleParser(msg.source);
                            const fromAddress = parsed.from?.value?.[0]?.address || '';
                            const fromName = parsed.from?.value?.[0]?.name || '';
                            const subject = parsed.subject || '(No subject)';
                            const date = parsed.date || new Date();
                            const bodyText = parsed.text || '';
                            const messageId = parsed.messageId || '';
                            const inReplyTo = parsed.inReplyTo || '';
                            const references = (Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references) || '';

                            // Hard block: skip entirely
                            if (BLOCKED_SENDERS.has(fromAddress.toLowerCase())) {
                                console.log(`[INBOX] BLOCKED sender, skipping entirely: ${fromAddress}`);
                                continue;
                            }

                            console.log(`[INBOX] Processing: ${fromAddress} — ${subject}`);

                            // ============================================================
                            // OWNER EMAIL COMMAND DETECTION
                            // ============================================================
                            const ownerAuth = authenticateOwnerEmail(fromAddress, bodyText);
                            if (ownerAuth.isOwner && ownerAuth.command) {
                                console.log(`[INBOX] OWNER COMMAND detected from ${fromAddress}`);

                                // Log the command attempt for audit
                                try {
                                    const auditEntry = {
                                        timestamp: new Date().toISOString(),
                                        from: fromAddress,
                                        subject,
                                        command: ownerAuth.command.substring(0, 500),
                                        authenticated: true,
                                    };
                                    await appendFile(
                                        path.join(WORKSPACE_PATH, 'logs', 'email-commands.jsonl'),
                                        JSON.stringify(auditEntry) + '\n'
                                    );
                                } catch {}

                                // Process the command through chatSystem
                                const commandResponse = await processOwnerCommand(
                                    ownerAuth.command,
                                    fromName,
                                    fromAddress,
                                    subject
                                );

                                // Send email reply with the response
                                const responseHtml = buildReplyHtml(
                                    `<p>Hi Lee,</p>` +
                                    `<p>I've processed your command. Here's my response:</p>` +
                                    `<div style="background: #f9f9f9; padding: 16px; border-left: 3px solid #1a1a2e; margin: 16px 0; white-space: pre-wrap;">${commandResponse.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>` +
                                    `<p>Let me know if you need anything else.</p>`
                                );
                                await sendReplyEmail(fromAddress, subject, responseHtml);
                                console.log(`[INBOX] Owner command response sent`);

                                // Notify via Telegram
                                await notifyOwnerCommandProcessed(subject, ownerAuth.command, commandResponse);

                                // Mark as seen and continue to next email
                                seen.add(uid);
                                newCount++;

                                if (postDashboard) {
                                    postDashboard('add_activity', { entry: `Email command from Lee: ${subject.substring(0, 40)} — processed` });
                                }
                                continue;
                            }

                            // Log failed owner auth attempts (passphrase from wrong sender)
                            if (OWNER_PASSPHRASE.test(bodyText) && fromAddress.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
                                console.warn(`[INBOX] WARNING: Passphrase detected from non-owner: ${fromAddress}`);
                                try {
                                    const auditEntry = {
                                        timestamp: new Date().toISOString(),
                                        from: fromAddress,
                                        subject,
                                        authenticated: false,
                                        reason: 'passphrase_wrong_sender',
                                    };
                                    await appendFile(
                                        path.join(WORKSPACE_PATH, 'logs', 'email-commands.jsonl'),
                                        JSON.stringify(auditEntry) + '\n'
                                    );
                                } catch {}
                            }

                            // ============================================================
                            // STANDARD EMAIL PROCESSING (non-owner)
                            // ============================================================

                            // Detect if sender wants a voice response
                            const voiceRequested = wantsVoiceReply(subject, bodyText);
                            if (voiceRequested) {
                                console.log(`[INBOX] Voice response requested by ${fromAddress}`);
                            }

                            // Generate AI reply and send if appropriate
                            let autoReplied = false;
                            let replyText = '';
                            let voiceSent = false;
                            if (shouldAutoReply(fromAddress) && !hasReplyLoopRisk(fromAddress, subject)) {
                                try {
                                    const aiReplyHtml = await generateAIReply(fromName, fromAddress, subject, bodyText, voiceRequested);
                                    const finalHtml = aiReplyHtml
                                        ? buildReplyHtml(aiReplyHtml)
                                        : buildFallbackReplyHtml();
                                    replyText = aiReplyHtml || 'Standard acknowledgement';

                                    // Generate voice attachment if requested
                                    const attachments = [];
                                    let voicePath = null;
                                    if (voiceRequested) {
                                        voicePath = await generateVoiceFile(replyText);
                                        if (voicePath) {
                                            attachments.push({
                                                filename: 'alex-voice-response.mp3',
                                                path: voicePath,
                                                contentType: 'audio/mpeg',
                                            });
                                            voiceSent = true;
                                        }
                                    }

                                    // Add note about voice in the email body if voice is attached
                                    let emailHtml = finalHtml;
                                    if (voiceSent) {
                                        const voiceNote = `<p style="margin-top: 16px; padding: 12px; background: #f8f8f8; border-left: 3px solid #1a1a2e; font-size: 13px; color: #555;">🎙 I've attached a voice version of this response as requested. You can listen to it in the attached MP3 file.</p>`;
                                        emailHtml = finalHtml.replace(SIG_HTML, voiceNote + SIG_HTML);
                                    }

                                    await sendReplyEmail(fromAddress, subject, emailHtml, attachments);
                                    autoReplied = true;
                                    recordAutoReply(fromAddress, subject);
                                    console.log(`[INBOX] AI reply sent to ${fromAddress}${voiceSent ? ' (with voice)' : ''}`);

                                    // Clean up voice file after sending
                                    if (voicePath) {
                                        unlink(voicePath).catch(() => {});
                                    }
                                } catch (replyErr) {
                                    console.error(`[INBOX] Reply failed for ${fromAddress}:`, replyErr.message);
                                }
                            } else {
                                console.log(`[INBOX] Skipped reply for ${fromAddress} (filtered)`);
                            }

                            // File email in the inbox system
                            let filedEmail = null;
                            try {
                                filedEmail = await fileEmail({
                                    uid, fromName, fromAddress, subject, bodyText,
                                    date, messageId, inReplyTo, references,
                                    autoReplied,
                                });
                            } catch (fileErr) {
                                console.error(`[INBOX] Filing failed:`, fileErr.message);
                            }

                            // Always notify Lee via Telegram with AI summary + triage info
                            try {
                                await sendTelegramNotification(fromName, fromAddress, subject, date, bodyText, autoReplied, replyText, voiceRequested, voiceSent, filedEmail);
                                console.log(`[INBOX] Telegram notification sent for: ${subject}`);
                            } catch (notifyErr) {
                                console.error(`[INBOX] Telegram notification failed:`, notifyErr.message);
                            }

                            // Mark as seen on IMAP
                            try {
                                await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
                            } catch {}

                            seen.add(uid);
                            newCount++;

                            if (postDashboard) {
                                const action = autoReplied ? (voiceSent ? 'replied + voice' : 'replied') : 'notified';
                                postDashboard('add_activity', { entry: `Email from ${fromName || fromAddress}: ${subject.substring(0, 60)} — ${action}` });
                            }
                        } catch (msgErr) {
                            console.error(`[INBOX] Error processing UID ${uid}:`, msgErr.message);
                            seen.add(uid);
                        }
                    }
                }
            }
        } finally {
            lock.release();
        }

        await saveSeenUIDs(seen);
        try { await client.logout(); } catch {}

        if (newCount > 0) {
            console.log(`[INBOX] Done — processed ${newCount} new email(s)`);
        }
    } catch (err) {
        console.error(`[INBOX] Poll #${pollCount} error:`, err.message);
        try { await client?.logout(); } catch {}
    } finally {
        polling = false;
    }
}
