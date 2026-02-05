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

function verifyAdmin(req) {
  const cookie = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('admin_token='));
  if (!cookie) return false;
  const token = cookie.split('=')[1];
  if (!token) return false;
  try {
    const [payload, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', process.env.ADMIN_SECRET || 'fallback-secret').update(payload).digest('hex');
    if (sig !== expected) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64').toString());
    if (Date.now() - data.ts > 86400000) return false;
    return true;
  } catch { return false; }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }

  try {
    const { key } = req.body || {};
    if (!key || !key.startsWith('nav_')) {
      return res.status(400).json({ error: 'Invalid key format' });
    }

    const r = getRedis();
    const data = await r.hgetall(`apikey:${key}`);
    if (!data || !data.key) {
      return res.status(404).json({ error: 'Key not found' });
    }

    await r.hset(`apikey:${key}`, { status: 'revoked' });
    return res.status(200).json({ ok: true, message: 'Key revoked' });
  } catch (e) {
    console.error('Key revoke error:', e);
    return res.status(500).json({ error: 'Failed to revoke key' });
  }
};
