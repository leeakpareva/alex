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

  const r = getRedis();

  try {
    // If a specific key is requested, return its value
    const keyParam = req.query.key;
    if (keyParam) {
      const type = await r.type(keyParam);
      const ttl = await r.ttl(keyParam);
      let value;

      if (type === 'string') {
        value = await r.get(keyParam);
      } else if (type === 'hash') {
        value = await r.hgetall(keyParam);
      } else if (type === 'set') {
        value = await r.smembers(keyParam);
      } else if (type === 'list') {
        value = await r.lrange(keyParam, 0, -1);
      } else if (type === 'none') {
        return res.status(404).json({ error: 'Key not found' });
      } else {
        value = `(unsupported type: ${type})`;
      }

      // Try to parse string values as JSON for display
      let parsed = value;
      if (typeof value === 'string') {
        try { parsed = JSON.parse(value); } catch { parsed = value; }
      }

      return res.status(200).json({
        key: keyParam,
        type,
        ttl: ttl === -1 ? 'no expiry' : ttl === -2 ? 'expired' : `${ttl}s`,
        ttl_seconds: ttl,
        value: parsed,
      });
    }

    // Scan all keys and group by prefix
    const allKeys = [];
    let cursor = '0';
    do {
      const result = await r.scan(cursor, { count: 100 });
      cursor = String(result[0]);
      allKeys.push(...result[1]);
    } while (cursor !== '0');

    // Get type and TTL for each key (batch, max 50 at a time)
    const keyDetails = [];
    for (let i = 0; i < allKeys.length; i += 20) {
      const batch = allKeys.slice(i, i + 20);
      const details = await Promise.all(
        batch.map(async (key) => {
          const [type, ttl] = await Promise.all([r.type(key), r.ttl(key)]);
          return { key, type, ttl };
        })
      );
      keyDetails.push(...details);
    }

    // Group by prefix (everything before the first colon)
    const groups = {};
    for (const detail of keyDetails) {
      const colonIdx = detail.key.indexOf(':');
      const prefix = colonIdx > 0 ? detail.key.substring(0, colonIdx) : '(no prefix)';
      if (!groups[prefix]) groups[prefix] = { count: 0, keys: [] };
      groups[prefix].count++;
      groups[prefix].keys.push({
        key: detail.key,
        type: detail.type,
        ttl: detail.ttl === -1 ? 'no expiry' : detail.ttl === -2 ? 'expired' : `${detail.ttl}s`,
        ttl_seconds: detail.ttl,
      });
    }

    // Sort keys within each group
    for (const prefix of Object.keys(groups)) {
      groups[prefix].keys.sort((a, b) => a.key.localeCompare(b.key));
    }

    return res.status(200).json({
      total_keys: allKeys.length,
      groups,
      scanned_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('Admin redis error:', e);
    return res.status(500).json({ error: 'Failed to scan Redis' });
  }
};
