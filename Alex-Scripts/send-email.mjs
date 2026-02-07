#!/usr/bin/env node
/**
 * Standalone email sender — usable from Claude Code or CLI
 *
 * Usage:
 *   node scripts/send-email.mjs --to "email@example.com" --subject "Subject" --body "HTML body"
 *   node scripts/send-email.mjs --to "email@example.com" --subject "Subject" --body-file /path/to/body.html
 *   node scripts/send-email.mjs --to "email@example.com" --subject "Subject" --body "text" --attachment /path/to/file
 */

import nodemailer from 'nodemailer';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { loadEncryptedConfig } from '../src/secrets.js';

const CONFIG_PATH = process.env.ALEX_CONFIG || path.join(os.homedir(), '.alex/config.json');

async function main() {
    const args = process.argv.slice(2);
    const flags = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].slice(2);
            flags[key] = args[i + 1] || '';
            i++;
        }
    }

    if (!flags.to || !flags.subject) {
        console.error('Usage: send-email.mjs --to <email> --subject <subject> --body <html> [--body-file <path>] [--attachment <path>]');
        process.exit(1);
    }

    const passphrase = process.env.ALEX_SECRET_KEY;
    const { config } = await loadEncryptedConfig(CONFIG_PATH, passphrase);
    if (!config.gmail_address || !config.gmail_app_password) {
        console.error('Email credentials not configured');
        process.exit(1);
    }

    let body = flags.body || '';
    if (flags['body-file']) {
        body = await fs.readFile(flags['body-file'], 'utf-8');
    }

    // Wrap plain text in basic HTML if needed
    if (body && !body.includes('<')) {
        body = `<div style="font-family: Georgia, 'Times New Roman', serif; font-size: 15px; line-height: 1.7; color: #1a1a1a; max-width: 640px; margin: 0 auto; padding: 20px;">${body.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</div>`;
    }

    const transporter = nodemailer.createTransport({
        host: config.email_smtp_host || 'smtppro.zoho.eu',
        port: config.email_smtp_port || 465,
        secure: true,
        auth: { user: config.gmail_address, pass: config.gmail_app_password },
    });

    const mailOptions = {
        from: `"ALEX — NAVADA" <${config.gmail_address}>`,
        to: flags.to,
        subject: flags.subject,
        html: body,
        attachments: [],
    };

    if (flags.attachment) {
        mailOptions.attachments.push({
            filename: path.basename(flags.attachment),
            path: flags.attachment,
        });
    }

    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${flags.to} — messageId: ${info.messageId}`);
}

main().catch(err => {
    console.error('Failed to send email:', err.message);
    process.exit(1);
});
