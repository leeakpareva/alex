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
    if (Date.now() - data.ts > 86400000) return false; // 24h expiry
    return true;
  } catch { return false; }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }

  try {
    const r = getRedis();
    const keyIds = await r.smembers('apikeys:index');
    if (!keyIds || !keyIds.length) return res.status(200).json({ keys: [] });

    const keys = [];
    for (const keyId of keyIds) {
      const data = await r.hgetall(`apikey:${keyId}`);
      if (data && data.key) {
        const today = new Date().toISOString().split('T')[0];
        const rateCount = await r.get(`apikey:rate:${keyId}:${today}`) || 0;
        keys.push({
          key_masked: data.key.slice(0, 8) + '...' + data.key.slice(-4),
          key_full: data.key,
          name: data.name,
          email: data.email,
          created: data.created,
          status: data.status,
          requests_today: Number(rateCount),
          last_used: data.last_used || '',
        });
      }
    }

    keys.sort((a, b) => new Date(b.created) - new Date(a.created));
    return res.status(200).json({ keys, total: keys.length });
  } catch (e) {
    console.error('Key list error:', e);
    return res.status(500).json({ error: 'Failed to list keys' });
  }
};
