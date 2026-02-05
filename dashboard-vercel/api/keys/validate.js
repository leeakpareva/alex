const { Redis } = require('@upstash/redis');

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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const key = req.headers['x-api-key'] || req.query.key;
  if (!key || !key.startsWith('nav_')) {
    return res.status(400).json({ valid: false, error: 'Missing or invalid API key' });
  }

  try {
    const data = await getRedis().hgetall(`apikey:${key}`);
    if (!data || !data.key) {
      return res.status(404).json({ valid: false, error: 'Key not found' });
    }
    if (data.status !== 'active') {
      return res.status(403).json({ valid: false, error: 'Key has been revoked' });
    }
    return res.status(200).json({ valid: true, name: data.name, created: data.created });
  } catch (e) {
    console.error('Key validation error:', e);
    return res.status(500).json({ error: 'Validation failed' });
  }
};
