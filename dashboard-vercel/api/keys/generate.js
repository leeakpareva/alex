const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

let redis;
function getRedis() {
  if (!redis) {
    redis = new Redis({
      url: (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').trim(),
      token: (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '').trim(),
    });
  }
  return redis;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, email } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'A label name (min 2 characters) is required' });
    }

    const key = 'nav_' + crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const r = getRedis();

    const keyData = {
      name: name.trim().slice(0, 100),
      email: email ? String(email).trim().slice(0, 200) : '',
      key,
      created: now,
      status: 'active',
      requests_today: 0,
      last_used: '',
    };

    await Promise.all([
      r.hset(`apikey:${key}`, keyData),
      r.sadd('apikeys:index', key),
    ]);

    return res.status(201).json({ key, name: keyData.name, created: now });
  } catch (e) {
    console.error('Key generation error:', e);
    return res.status(500).json({ error: 'Failed to generate key' });
  }
};
