const { Redis } = require('@upstash/redis');

async function fetchJson(url, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`Upstream ${r.status}`);
  return r.json();
}

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
    const url = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').trim();
    const token = (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '').trim();

    if (url && token) {
      const data = await getRedis().get('dash:commits');
      return res.status(200).json(data || {});
    }

    const alex = (process.env.ALEX_API_BASE_URL || '').replace(/\/+$/, '');
    if (!alex) return res.status(500).json({ error: 'Missing UPSTASH_* or ALEX_API_BASE_URL' });
    const data = await fetchJson(`${alex}/api/dashboard/commits`, process.env.ALEX_DASHBOARD_READ_TOKEN || '');
    return res.status(200).json(data || { commits: [] });
  } catch (e) {
    console.error('Commits error:', e);
    return res.status(500).json({ error: e.message });
  }
};
