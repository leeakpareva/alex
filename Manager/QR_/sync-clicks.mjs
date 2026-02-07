#!/usr/bin/env node
/**
 * Sync QR click logs from Upstash Redis → local QR_ folder.
 * Run manually or via cron:  node /home/head/ALEX_NAVADA/Manager/QR_/sync-clicks.mjs
 *
 * Pulls all entries from Redis qr:clicks list, appends to clicks.log,
 * and updates clicks.json with the full history.
 */

import { Redis } from '@upstash/redis';
import { readFile, writeFile, appendFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_FILE = join(__dirname, 'clicks.log');
const JSON_FILE = join(__dirname, 'clicks.json');

// Load Redis credentials from dashboard-vercel .env.local
const envPath = '/home/head/navada-1/dashboard-vercel/.env.local';
const env = {};
try {
  for (const line of (await readFile(envPath, 'utf8')).split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
  }
} catch {
  console.error('Cannot read', envPath);
  process.exit(1);
}

const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
if (!url || !token) {
  console.error('Missing UPSTASH_REDIS credentials in .env.local');
  process.exit(1);
}

const redis = new Redis({ url, token });

// Pull all clicks from Redis (drains the list)
const len = await redis.llen('qr:clicks');
if (len === 0) {
  console.log('No new QR clicks to sync.');
  process.exit(0);
}

// Get all entries then clear the list
const raw = await redis.lrange('qr:clicks', 0, -1);
await redis.del('qr:clicks');

const clicks = raw.map(entry => {
  try { return typeof entry === 'string' ? JSON.parse(entry) : entry; }
  catch { return { raw: entry }; }
}).reverse(); // oldest first

// Load existing JSON history
let history = [];
try {
  history = JSON.parse(await readFile(JSON_FILE, 'utf8'));
} catch {}

history.push(...clicks);
await writeFile(JSON_FILE, JSON.stringify(history, null, 2));

// Append to human-readable log
const logLines = clicks.map(c => {
  const date = c.timestamp ? new Date(c.timestamp).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : 'unknown';
  return `[${date}] ${c.ip || '-'} | ${c.destination || '-'} | ${c.user_agent || '-'} | ref: ${c.referer || '-'}`;
}).join('\n') + '\n';

await appendFile(LOG_FILE, logLines);

console.log(`Synced ${clicks.length} QR click(s). Total: ${history.length}`);
