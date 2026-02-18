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

  const sessionId = req.query.sessionId;
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  try {
    const r = getRedis();
    const key = `web:chat:out:${sessionId.slice(0, 64)}`;
    const data = await r.get(key);

    if (!data) {
      return res.status(200).json({ response: null, pending: true });
    }

    const parsed = typeof data === 'string' ? JSON.parse(data) : data;

    // Delete after reading so we don't re-deliver
    await r.del(key);

    return res.status(200).json({
      response: parsed.response,
      attachments: parsed.attachments || [],
      tools_used: parsed.tools_used || [],
      timestamp: parsed.timestamp,
      pending: false,
      status: 'complete',
    });
  } catch (e) {
    console.error('Chat poll error:', e);
    return res.status(500).json({ error: 'Failed to poll response' });
  }
};
