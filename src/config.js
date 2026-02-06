/**
 * Configuration loading, validation, and constants
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { loadEncryptedConfig, saveEncryptedConfig } from './secrets.js';

export const CONFIG_PATH = process.env.ALEX_CONFIG || path.join(os.homedir(), '.alex/config.json');
export const WORKSPACE_PATH = process.env.ALEX_WORKSPACE || path.join(os.homedir(), '.alex');
export const SECRET_KEY = process.env.ALEX_SECRET_KEY || null;

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
    apify_api_key: { type: 'string' },
    openrouter_api_key: { type: 'string' },
    chromadb_api_key: { type: 'string' },
    chromadb_tenant: { type: 'string' },
    chromadb_database: { type: 'string' },
    local_redis_url: { type: 'string' },
};

/**
 * Load YAML config for non-secret behavioral settings.
 * Returns empty object if file doesn't exist or fails to parse.
 */
export async function loadYamlConfig() {
    const yamlPath = path.join(WORKSPACE_PATH, 'config.yaml');
    try {
        const content = await fs.readFile(yamlPath, 'utf8');
        const parsed = yaml.load(content) || {};
        console.log('[CONFIG] YAML config loaded');
        return parsed;
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.warn(`[CONFIG] YAML config error: ${err.message}`);
        }
        return {};
    }
}

export async function loadConfig() {
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });

    let config;
    let configMeta;
    try {
        configMeta = await loadEncryptedConfig(CONFIG_PATH, SECRET_KEY);
        config = configMeta.config;
    } catch (err) {
        console.error(`Config error: ${err.message}`);
        console.log('Run: alex-setup to configure');
        process.exit(1);
    }

    // Merge YAML config (non-secrets) — JSON wins on conflicts
    const yamlConfig = await loadYamlConfig();
    config._yaml = yamlConfig;

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

    // Store config path and encryption status for tools that need to write back
    config._configPath = CONFIG_PATH;
    config._encrypted = configMeta.encrypted;
    config._secretKey = SECRET_KEY;

    console.log('[CONFIG] Loaded and validated');
    return config;
}

/**
 * Save config back to file (encrypted if key available)
 */
export async function saveConfig(config) {
    const { _configPath, _encrypted, _secretKey, ...cleanConfig } = config;
    await saveEncryptedConfig(cleanConfig, _configPath || CONFIG_PATH, _secretKey || SECRET_KEY);
}

/**
 * Check if a path is within allowed directories
 */
export function isPathAllowed(filePath, allowedPaths) {
    const resolved = path.resolve(filePath);
    return allowedPaths.some(allowed => resolved.startsWith(path.resolve(allowed)));
}
