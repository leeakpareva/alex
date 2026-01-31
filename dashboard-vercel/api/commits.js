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
  try {
    const data = await getRedis().get('dash:commits');
    return res.status(200).json(data || {});
  } catch (e) {
    console.error('Commits error:', e);
    return res.status(500).json({ error: e.message });
  }
};
