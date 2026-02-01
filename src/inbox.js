/**
 * Gmail Inbox Monitoring — polls IMAP every 2 minutes
 * Uses Claude to generate intelligent replies, notifies Lee via Telegram
 */

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { WORKSPACE_PATH } from './config.js';

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

export function setupInbox(deps) {
    config = deps.config;
    bot = deps.bot;
    postDashboard = deps.postDashboard;
    anthropic = deps.anthropic;
    openaiClient = deps.openaiClient;
    console.log(`[INBOX] Setup complete — AI replies enabled, voice ${openaiClient ? 'enabled' : 'disabled'}`);
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
];

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
${voiceRequested ? '- The sender has requested a voice response. Mention naturally in your reply that you have attached an audio version of your response for their convenience. Keep the written reply full and complete — the voice is a bonus, not a replacement.' : ''}`;

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

async function sendTelegramNotification(fromName, fromAddress, subject, date, bodyText, autoReplied, replyText, voiceRequested = false, voiceSent = false) {
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
    let msg = `*New Email Handled*\n\n`;
    msg += `From: ${fromName || 'Unknown'} (${fromAddress})\n`;
    msg += `Subject: ${subject}\n`;
    msg += `Received: ${dateFmt}\n`;
    msg += `Action: ${replyStatus}\n\n`;

    if (aiSummary) {
        msg += `*ALEX's assessment:*\n${aiSummary}\n\n`;
    }

    msg += `*Email preview:*\n${emailPreview}`;

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

                            console.log(`[INBOX] Processing: ${fromAddress} — ${subject}`);

                            // Detect if sender wants a voice response
                            const voiceRequested = wantsVoiceReply(subject, bodyText);
                            if (voiceRequested) {
                                console.log(`[INBOX] Voice response requested by ${fromAddress}`);
                            }

                            // Generate AI reply and send if appropriate
                            let autoReplied = false;
                            let replyText = '';
                            let voiceSent = false;
                            if (shouldAutoReply(fromAddress)) {
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

                            // Always notify Lee via Telegram with AI summary
                            try {
                                await sendTelegramNotification(fromName, fromAddress, subject, date, bodyText, autoReplied, replyText, voiceRequested, voiceSent);
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
