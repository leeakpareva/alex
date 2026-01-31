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
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.PUSH_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { dashboard, tokens, commits } = req.body;
    const r = getRedis();

    await Promise.all([
      dashboard != null ? r.set('dash:data', JSON.stringify(dashboard)) : Promise.resolve(),
      tokens != null ? r.set('dash:tokens', JSON.stringify(tokens)) : Promise.resolve(),
      commits != null ? r.set('dash:commits', JSON.stringify(commits)) : Promise.resolve(),
    ]);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Push error:', e);
    return res.status(500).json({ error: e.message });
  }
};
