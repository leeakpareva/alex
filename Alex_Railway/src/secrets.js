/**
 * Secrets management — AES-256-GCM encryption for sensitive config
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// Encryption parameters
const ALGORITHM = 'aes-256-gcm';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Derive encryption key from passphrase using scrypt
 */
export function deriveKey(passphrase, salt) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(
            passphrase,
            salt,
            KEY_LENGTH,
            { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
            (err, key) => {
                if (err) reject(err);
                else resolve(key);
            }
        );
    });
}

/**
 * Encrypt data with AES-256-GCM
 * Returns: salt (16) + iv (12) + authTag (16) + ciphertext as base64
 */
export async function encrypt(plaintext, passphrase) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = await deriveKey(passphrase, salt);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    // Combine: salt + iv + authTag + ciphertext
    const combined = Buffer.concat([salt, iv, authTag, encrypted]);
    return combined.toString('base64');
}

/**
 * Decrypt data with AES-256-GCM
 */
export async function decrypt(ciphertext, passphrase) {
    const combined = Buffer.from(ciphertext, 'base64');

    // Extract components
    const salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

    const key = await deriveKey(passphrase, salt);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    try {
        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]);
        return decrypted.toString('utf8');
    } catch (err) {
        throw new Error('Decryption failed — invalid key or corrupted data');
    }
}

/**
 * Migrate plaintext config to encrypted format
 */
export async function migrateConfig(configPath, encConfigPath, passphrase) {
    try {
        const plaintext = await fs.readFile(configPath, 'utf-8');
        JSON.parse(plaintext); // Validate JSON

        const encrypted = await encrypt(plaintext, passphrase);
        await fs.writeFile(encConfigPath, encrypted, 'utf-8');
        await fs.chmod(encConfigPath, 0o600);

        console.log('[SECRETS] Config migrated to encrypted format');
        return true;
    } catch (err) {
        console.error('[SECRETS] Migration failed:', err.message);
        return false;
    }
}

/**
 * Load config — tries encrypted first, falls back to plaintext
 */
export async function loadEncryptedConfig(configPath, passphrase) {
    const encConfigPath = configPath + '.enc';

    // Try encrypted config first
    try {
        const encrypted = await fs.readFile(encConfigPath, 'utf-8');
        if (!passphrase) {
            throw new Error('ALEX_SECRET_KEY environment variable required for encrypted config');
        }
        const decrypted = await decrypt(encrypted, passphrase);
        console.log('[SECRETS] Loaded encrypted config');
        return { config: JSON.parse(decrypted), encrypted: true, path: encConfigPath };
    } catch (err) {
        if (err.code !== 'ENOENT') {
            // Encrypted file exists but failed to decrypt
            throw err;
        }
    }

    // Fall back to plaintext
    try {
        const plaintext = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(plaintext);

        // Auto-migrate if passphrase is available
        if (passphrase) {
            console.log('[SECRETS] Plaintext config found — migrating to encrypted...');
            const migrated = await migrateConfig(configPath, encConfigPath, passphrase);
            if (migrated) {
                console.log('[SECRETS] Migration complete. Consider removing plaintext config.');
            }
        } else {
            console.log('[CONFIG] Using plaintext config (set ALEX_SECRET_KEY to enable encryption)');
        }

        return { config, encrypted: false, path: configPath };
    } catch (err) {
        throw new Error(`Config not found at ${configPath}: ${err.message}`);
    }
}

/**
 * Save config — encrypts if passphrase available
 */
export async function saveEncryptedConfig(config, configPath, passphrase) {
    const encConfigPath = configPath + '.enc';
    const content = JSON.stringify(config, null, 2);

    if (passphrase) {
        const encrypted = await encrypt(content, passphrase);
        await fs.writeFile(encConfigPath, encrypted, 'utf-8');
        await fs.chmod(encConfigPath, 0o600);
        console.log('[SECRETS] Config saved (encrypted)');
    } else {
        await fs.writeFile(configPath, content, 'utf-8');
        await fs.chmod(configPath, 0o600);
        console.log('[CONFIG] Config saved (plaintext)');
    }
}

/**
 * Generate a secure random key for ALEX_SECRET_KEY
 */
export function generateSecretKey() {
    return crypto.randomBytes(32).toString('base64');
}
