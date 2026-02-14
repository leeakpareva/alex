/**
 * /qr — 302 redirect to configurable destination.
 * Scan the QR code → hits this endpoint → redirects to the main site.
 * Change QR_DESTINATION_URL env var to retarget without reprinting.
 * Logs every click to Redis (qr:clicks list) for analytics.
 */
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
  const destination = process.env.QR_DESTINATION_URL || 'https://alexnavada.xyz';
  const now = new Date().toISOString();
  const ua = req.headers?.['user-agent'] || 'unknown';
  const ip = req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const referer = req.headers?.['referer'] || '';

  console.log(`[QR] ${now} redirect → ${destination} | UA: ${ua}`);

  // Log click to Redis before responding (must await — serverless kills process after res.end)
  try {
    const click = { timestamp: now, destination, user_agent: ua, ip, referer };
    await getRedis().lpush('qr:clicks', JSON.stringify(click));
  } catch (e) {
    console.error('[QR] Redis log failed:', e.message);
  }

  res.setHeader('Location', destination);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(302).end();
};
