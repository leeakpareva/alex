/**
 * Email Filing System — AI triage, 3-status workflow, queries
 * Storage: ~/.alex/inbox/emails.json
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { WORKSPACE_PATH } from './config.js';

const INBOX_DIR = path.join(WORKSPACE_PATH, 'inbox');
const EMAILS_FILE = path.join(INBOX_DIR, 'emails.json');

let config = null;
let bot = null;
let anthropic = null;
let postDashboard = null;
let memory = null;
let chatSystem = null;

// Display number counter (resets on load based on existing emails)
let displayCounter = 0;

// ============================================================================
// SETUP
// ============================================================================

export function setupEmailFiling(deps) {
    config = deps.config;
    bot = deps.bot;
    anthropic = deps.anthropic;
    postDashboard = deps.postDashboard;
    memory = deps.memory;
    if (deps.chatSystem) chatSystem = deps.chatSystem;
    console.log('[EMAIL-FILING] Setup complete');
}

export function setEmailFilingChatSystem(cs) {
    chatSystem = cs;
}

// ============================================================================
// STORAGE
// ============================================================================

async function loadStore() {
    try {
        const raw = await readFile(EMAILS_FILE, 'utf-8');
        const store = JSON.parse(raw);
        // Restore display counter
        if (store.emails && store.emails.length > 0) {
            displayCounter = Math.max(...store.emails.map(e => e.display_number || 0));
        }
        return store;
    } catch {
        return { emails: [], stats: { not_started: 0, in_progress: 0, done: 0 } };
    }
}

async function saveStore(store) {
    // Recalculate stats
    store.stats = {
        not_started: store.emails.filter(e => e.status === 'not_started').length,
        in_progress: store.emails.filter(e => e.status === 'in_progress').length,
        done: store.emails.filter(e => e.status === 'done').length,
    };
    await mkdir(INBOX_DIR, { recursive: true });
    await writeFile(EMAILS_FILE, JSON.stringify(store, null, 2));
    const { chmod } = await import('fs/promises');
    await chmod(EMAILS_FILE, 0o600);
}

// ============================================================================
// AI TRIAGE (Haiku — cheap, fast)
// ============================================================================

export async function triageEmail(fromName, fromAddress, subject, bodyText) {
    if (!anthropic) {
        return {
            priority: 'medium',
            category: 'general',
            required_action: 'review',
            can_handle_autonomously: false,
            summary: `Email from ${fromName || fromAddress} about: ${subject}`,
            suggested_response: 'Review and respond as appropriate',
        };
    }

    const prompt = `You are an AI email triage system for ALEX at NAVADA (a technology and economics research organisation). Classify this email.

From: ${fromName || 'Unknown'} <${fromAddress}>
Subject: ${subject}
Body (first 2000 chars):
${(bodyText || '').substring(0, 2000)}

Return ONLY valid JSON (no markdown, no code fences):
{
  "priority": "high|medium|low|spam",
  "category": "partnership|business|research|personal|newsletter|notification|spam|support|media|recruitment|other",
  "required_action": "reply_needed|fyi_only|urgent_reply|meeting_request|follow_up|archive|spam",
  "can_handle_autonomously": true/false,
  "summary": "One-line summary of what this email is about and what they want",
  "suggested_response": "Brief suggestion for how to respond, or 'No response needed'"
}

Rules:
- can_handle_autonomously = true ONLY for simple acknowledgements, newsletters, notifications, or clear routine replies
- can_handle_autonomously = false for anything requiring Lee's input, decision, or personal touch
- priority=high for partners, investors, media, urgent requests
- priority=spam for obvious spam/marketing
- Be concise in summary and suggested_response`;

    try {
        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 400,
            messages: [{ role: 'user', content: prompt }],
        });

        const text = response.content?.[0]?.text || '';
        // Extract JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                priority: parsed.priority || 'medium',
                category: parsed.category || 'other',
                required_action: parsed.required_action || 'review',
                can_handle_autonomously: !!parsed.can_handle_autonomously,
                summary: parsed.summary || subject,
                suggested_response: parsed.suggested_response || 'Review and respond',
            };
        }
    } catch (err) {
        console.error('[EMAIL-FILING] Triage failed:', err.message);
    }

    return {
        priority: 'medium',
        category: 'other',
        required_action: 'review',
        can_handle_autonomously: false,
        summary: `Email from ${fromName || fromAddress}: ${subject}`,
        suggested_response: 'Review and respond as appropriate',
    };
}

// ============================================================================
// FILE EMAIL
// ============================================================================

export async function fileEmail({ uid, fromName, fromAddress, subject, bodyText, date, messageId, inReplyTo, references, autoReplied }) {
    const store = await loadStore();

    // Thread detection — check if this is a reply to an existing email
    let threadId = null;
    if (inReplyTo || references) {
        const refIds = [inReplyTo, ...(references || '').split(/\s+/)].filter(Boolean);
        for (const existing of store.emails) {
            if (refIds.includes(existing.message_id)) {
                threadId = existing.thread_id || existing.id;
                break;
            }
        }
    }

    displayCounter++;
    const id = `e_${Date.now()}`;

    const triage = await triageEmail(fromName, fromAddress, subject, bodyText);

    const record = {
        id,
        display_number: displayCounter,
        uid,
        status: 'not_started',
        from_name: fromName || '',
        from_address: fromAddress || '',
        subject: subject || '(No subject)',
        body_text: (bodyText || '').substring(0, 10000),
        body_preview: (bodyText || '').substring(0, 300),
        date: date ? new Date(date).toISOString() : new Date().toISOString(),
        received_at: new Date().toISOString(),
        message_id: messageId || '',
        thread_id: threadId || id,
        triage,
        auto_replied: !!autoReplied,
        actions: [],
        updated_at: new Date().toISOString(),
    };

    if (autoReplied) {
        record.actions.push({
            timestamp: new Date().toISOString(),
            type: 'auto_reply',
            description: 'Sent initial acknowledgement',
        });
    }

    store.emails.unshift(record);

    // Keep max 500 emails in store
    if (store.emails.length > 500) {
        store.emails = store.emails.slice(0, 500);
    }

    await saveStore(store);
    console.log(`[EMAIL-FILING] Filed #${displayCounter}: ${fromAddress} — ${subject} [${triage.priority}]`);

    // Push inbox update to dashboard
    if (postDashboard) {
        try {
            const summary = await getInboxSummary();
            postDashboard('update_inbox', summary);
        } catch {}
    }

    return record;
}

// ============================================================================
// STATUS TRANSITIONS
// ============================================================================

export async function updateEmailStatus(emailId, newStatus, actionDescription) {
    const store = await loadStore();
    const email = store.emails.find(e => e.id === emailId);
    if (!email) return null;

    email.status = newStatus;
    email.updated_at = new Date().toISOString();

    if (actionDescription) {
        email.actions.push({
            timestamp: new Date().toISOString(),
            type: newStatus === 'done' ? 'completed' : 'status_change',
            description: actionDescription,
        });
    }

    await saveStore(store);

    // Push inbox update to dashboard
    if (postDashboard) {
        try {
            const summary = await getInboxSummary();
            postDashboard('update_inbox', summary);
        } catch {}
    }

    return email;
}

// ============================================================================
// ACTION EXECUTION — route through chatSystem with full email context
// ============================================================================

export async function actionEmail(emailId, instruction, chatId) {
    const store = await loadStore();
    const email = store.emails.find(e => e.id === emailId);
    if (!email) return { success: false, error: 'Email not found' };

    // Update to in_progress
    await updateEmailStatus(emailId, 'in_progress', `Action requested: ${instruction || 'autonomous'}`);

    const actionInstruction = instruction || email.triage?.suggested_response || 'Handle this email appropriately';

    const prompt = `[EMAIL ACTION REQUEST]
Email #${email.display_number} from ${email.from_name} (${email.from_address})
Subject: ${email.subject}
Date: ${email.date}
Priority: ${email.triage?.priority || 'unknown'}
Category: ${email.triage?.category || 'unknown'}
Body:
${email.body_text}

Lee's instruction: ${actionInstruction}

You have full tool access. Execute this action:
- If replying, use send_email to reply to ${email.from_address} with subject "Re: ${email.subject}"
- Use memory_save to log the interaction under 'tasks' category
- After completing, summarize what you did in 2-3 sentences.
- Be professional and represent NAVADA well.`;

    if (!chatSystem) {
        return { success: false, error: 'Chat system not available' };
    }

    try {
        const response = await chatSystem.chat(
            `email-action-${emailId}`,
            prompt,
            { first_name: 'Lee', username: 'lee' },
            { modelOverride: 'claude-sonnet-4-20250514' }
        );

        // Mark as done
        await updateEmailStatus(emailId, 'done', `Completed: ${response.substring(0, 200)}`);

        // Notify Lee via Telegram
        if (bot && config?.telegram_owner_id) {
            const msg = `*Email #${email.display_number} done*\n\nFrom: ${email.from_name || email.from_address}\nSubject: ${email.subject}\n\n*What ALEX did:*\n${response.substring(0, 1500)}`;
            try {
                await bot.sendMessage(config.telegram_owner_id, msg, { parse_mode: 'Markdown' });
            } catch (sendErr) {
                try {
                    await bot.sendMessage(config.telegram_owner_id, msg.replace(/\*/g, ''));
                } catch {}
            }
        }

        // Email boss summary
        if (config?.gmail_address) {
            try {
                const nodemailer = await import('nodemailer');
                const transporter = nodemailer.default.createTransport({
                    host: config.email_smtp_host || 'smtppro.zoho.eu',
                    port: config.email_smtp_port || 465,
                    secure: true,
                    auth: { user: config.gmail_address, pass: config.gmail_app_password },
                });
                await transporter.sendMail({
                    from: `"ALEX — NAVADA" <${config.gmail_address}>`,
                    to: 'lee@navada.info',
                    subject: `[ALEX Inbox] Email #${email.display_number} resolved — ${email.subject}`,
                    html: `<div style="font-family: Georgia, serif; padding: 20px; max-width: 640px;">
                        <h3>Email #${email.display_number} — Resolved</h3>
                        <p><strong>From:</strong> ${email.from_name} (${email.from_address})</p>
                        <p><strong>Subject:</strong> ${email.subject}</p>
                        <p><strong>Action taken:</strong></p>
                        <p>${response.substring(0, 2000).replace(/\n/g, '<br>')}</p>
                    </div>`,
                });
            } catch (emailErr) {
                console.error('[EMAIL-FILING] Boss email failed:', emailErr.message);
            }
        }

        return { success: true, response, email };
    } catch (err) {
        console.error('[EMAIL-FILING] Action failed:', err.message);
        await updateEmailStatus(emailId, 'in_progress', `Action failed: ${err.message}`);
        return { success: false, error: err.message };
    }
}

// ============================================================================
// QUERIES
// ============================================================================

export async function getEmailsByStatus(status) {
    const store = await loadStore();
    if (status === 'all') return store.emails;
    return store.emails.filter(e => e.status === status);
}

export async function getEmailById(id) {
    const store = await loadStore();
    return store.emails.find(e => e.id === id) || null;
}

export async function getEmailByNumber(num) {
    const store = await loadStore();
    return store.emails.find(e => e.display_number === num) || null;
}

export async function getInboxSummary() {
    const store = await loadStore();
    const notStarted = store.emails.filter(e => e.status === 'not_started');
    const inProgress = store.emails.filter(e => e.status === 'in_progress');
    const doneRecent = store.emails.filter(e => e.status === 'done').slice(0, 10);

    return {
        not_started: notStarted.map(briefEmail),
        in_progress: inProgress.map(briefEmail),
        done_recent: doneRecent.map(briefEmail),
        stats: store.stats,
    };
}

function briefEmail(e) {
    return {
        id: e.id,
        num: e.display_number,
        from: e.from_name || e.from_address,
        subject: e.subject,
        priority: e.triage?.priority || 'medium',
        summary: e.triage?.summary || '',
        received_at: e.received_at,
        status: e.status,
        actions: e.actions?.length || 0,
    };
}

// ============================================================================
// BULK INBOX MANAGEMENT
// ============================================================================

/**
 * Clear emails by status. Returns count removed.
 * status: 'done' | 'not_started' | 'in_progress' | 'all'
 */
export async function clearEmailsByStatus(status) {
    const store = await loadStore();
    const before = store.emails.length;
    if (status === 'all') {
        store.emails = [];
    } else {
        store.emails = store.emails.filter(e => e.status !== status);
    }
    const removed = before - store.emails.length;
    if (removed > 0) await saveStore(store);
    return removed;
}

/**
 * Mark all emails with a given status to a new status. Returns count updated.
 */
export async function bulkUpdateStatus(fromStatus, toStatus) {
    const store = await loadStore();
    let count = 0;
    for (const e of store.emails) {
        if (e.status === fromStatus) {
            e.status = toStatus;
            e.updated_at = new Date().toISOString();
            count++;
        }
    }
    if (count > 0) await saveStore(store);
    return count;
}

/**
 * Delete a single email by display number. Returns true if found.
 */
export async function deleteEmailByNumber(num) {
    const store = await loadStore();
    const idx = store.emails.findIndex(e => e.display_number === num);
    if (idx === -1) return false;
    store.emails.splice(idx, 1);
    await saveStore(store);
    return true;
}

// ============================================================================
// ARCHIVE OLD DONE EMAILS (called by cleanup heartbeat)
// ============================================================================

export async function archiveOldDone() {
    const store = await loadStore();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const before = store.emails.length;
    store.emails = store.emails.filter(e => {
        if (e.status !== 'done') return true;
        const updated = new Date(e.updated_at || e.received_at);
        return updated > thirtyDaysAgo;
    });

    const pruned = before - store.emails.length;
    if (pruned > 0) {
        await saveStore(store);
        console.log(`[EMAIL-FILING] Archived ${pruned} old done emails`);
    }
    return pruned;
}
