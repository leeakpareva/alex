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
  // Try cookie first, then Authorization header
  let token = '';
  const cookie = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('admin_token='));
  if (cookie) token = cookie.substring(cookie.indexOf('=') + 1);
  if (!token) {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) token = auth.slice(7);
  }
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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }

  try {
    const r = getRedis();
    const keyIds = await r.smembers('apikeys:index');
    const today = new Date().toISOString().split('T')[0];

    let totalKeys = 0, activeKeys = 0, revokedKeys = 0, expiredKeys = 0, totalRequestsToday = 0;

    for (const keyId of (keyIds || [])) {
      const data = await r.hgetall(`apikey:${keyId}`);
      if (!data || !data.key) continue;
      totalKeys++;
      if (data.status === 'active') {
        // Check if expired by date
        if (!data.expires || new Date(data.expires) < new Date()) {
          expiredKeys++;
        } else {
          activeKeys++;
        }
      } else if (data.status === 'expired') {
        expiredKeys++;
      } else {
        revokedKeys++;
      }

      const rateCount = Number(await r.get(`apikey:rate:${keyId}:${today}`) || 0);
      totalRequestsToday += rateCount;
    }

    // Count registered contacts
    const contactEmails = await r.smembers('contacts:index');
    const totalContacts = (contactEmails && contactEmails.length) || 0;

    return res.status(200).json({
      total_keys: totalKeys,
      active_keys: activeKeys,
      revoked_keys: revokedKeys,
      expired_keys: expiredKeys,
      total_contacts: totalContacts,
      total_requests_today: totalRequestsToday,
      date: today,
    });
  } catch (e) {
    console.error('Admin stats error:', e);
    return res.status(500).json({ error: 'Failed to get stats' });
  }
};
