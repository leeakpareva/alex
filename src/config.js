/**
 * Configuration loading, validation, and constants
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export const CONFIG_PATH = process.env.ALEX_CONFIG || path.join(os.homedir(), '.alex/config.json');
export const WORKSPACE_PATH = process.env.ALEX_WORKSPACE || path.join(os.homedir(), '.alex');

// Allowed directories for file writes
export const ALLOWED_WRITE_PATHS = [
    WORKSPACE_PATH,
    '/tmp',
    '/home/head',
];

// Allowed directories for email attachments
export const ALLOWED_ATTACHMENT_PATHS = [
    WORKSPACE_PATH,
    '/tmp',
    '/home/head',
];

const REQUIRED_KEYS = ['anthropic_api_key', 'telegram_bot_token'];

const OPTIONAL_KEYS = {
    openai_api_key: { type: 'string' },
    gmail_address: { type: 'string' },
    gmail_app_password: { type: 'string' },
    recipient_email: { type: 'string' },
    telegram_owner_id: { type: 'number' },
    telegram_authorized_users: { type: 'array' },
    telegram_notify_tasks: { type: 'boolean' },
    auto_cc_email: { type: 'string' },
    deepseek_api_key: { type: 'string' },
    control_api_token: { type: 'string' },
    upstash_redis_url: { type: 'string' },
    upstash_redis_token: { type: 'string' },
    alphavantage_api_key: { type: 'string' },
    full_access_users: { type: 'array' },
    do_not_disturb: { type: 'boolean' },
    linkedin_client_id: { type: 'string' },
    linkedin_client_secret: { type: 'string' },
    linkedin_access_token: { type: 'string' },
    linkedin_refresh_token: { type: 'string' },
    linkedin_token_expires_at: { type: 'number' },
    linkedin_person_urn: { type: 'string' },
    google_calendar_client_id: { type: 'string' },
    google_calendar_client_secret: { type: 'string' },
    google_calendar_access_token: { type: 'string' },
    google_calendar_refresh_token: { type: 'string' },
    google_calendar_token_expires_at: { type: 'number' },
    kimi_api_key: { type: 'string' },
};

export async function loadConfig() {
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });

    let config;
    try {
        config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
    } catch {
        console.error(`Config not found at ${CONFIG_PATH}`);
        console.log('Run: alex-setup to configure');
        process.exit(1);
    }

    // Validate required keys
    for (const key of REQUIRED_KEYS) {
        if (!config[key]) {
            console.error(`Missing ${key} in config`);
            process.exit(1);
        }
    }

    // Validate optional keys types
    for (const [key, schema] of Object.entries(OPTIONAL_KEYS)) {
        if (config[key] !== undefined) {
            const actual = Array.isArray(config[key]) ? 'array' : typeof config[key];
            if (actual !== schema.type) {
                console.warn(`[CONFIG] Warning: ${key} should be ${schema.type}, got ${actual}`);
            }
        }
    }

    // Default auto_cc_email
    if (!config.auto_cc_email) {
        config.auto_cc_email = 'lee@navada.info';
    }

    // Store config path for tools that need to write back
    config._configPath = CONFIG_PATH;

    console.log('[CONFIG] Loaded and validated');
    return config;
}

/**
 * Check if a path is within allowed directories
 */
export function isPathAllowed(filePath, allowedPaths) {
    const resolved = path.resolve(filePath);
    return allowedPaths.some(allowed => resolved.startsWith(path.resolve(allowed)));
}
