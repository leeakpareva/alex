const { Redis } = require('@upstash/redis');
const crypto = require('crypto');
const { dispatch } = require('./handlers/router');

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

/** Build a param-aware cache key: api:v1:{endpoint}:{md5 of sorted params} */
function buildCacheKey(endpoint, query) {
  const params = Object.entries(query)
    .filter(([k]) => k !== 'endpoint')
    .sort(([a], [b]) => a.localeCompare(b));
  if (params.length === 0) return `api:v1:${endpoint}`;
  const hash = crypto.createHash('md5').update(JSON.stringify(params)).digest('hex').slice(0, 12);
  return `api:v1:${endpoint}:${hash}`;
}

const VALID_ENDPOINTS = new Set([
  'stock-quote', 'crypto-rate', 'forex-rate', 'market-news',
  'economic-indicator', 'company-overview', 'stock-search', 'commodity-price',
  'text-summary', 'sentiment-analysis', 'translate', 'explain-concept', 'quiz-generator',
  'country-info', 'weather', 'news-headlines', 'historical-events', 'unit-convert', 'time-zones',
  'math-solve', 'periodic-table', 'space-facts', 'statistics-calc', 'carbon-footprint',
  'qr-generate', 'color-palette', 'lorem-ipsum',
  'word-definition', 'book-summary', 'study-plan',
  // Future Economy — ALEX from 2036
  'ai-gdp-contribution', 'automation-velocity-index', 'ai-labor-displacement-rate',
  'model-market-index', 'ai-dependency-score', 'compute-purchasing-power',
  'skill-half-life', 'cognitive-augmentation-index', 'human-premium-index',
  'reskilling-roi', 'workforce-composition', 'talent-migration-flow',
  'synthetic-media-index', 'digital-identity-index', 'algorithmic-governance-score',
  'attention-economy-price', 'digital-commons-health', 'trust-infrastructure-index',
  'carbon-credit-market', 'planetary-boundary-index', 'ecosystem-service-valuation',
  'climate-adaptation-bond', 'energy-transition-tracker', 'stranded-asset-risk',
  'ubi-effectiveness-index', 'abundance-index', 'prosperity-beyond-gdp',
  'creative-economy-index', 'time-sovereignty-index', 'inequality-adjusted-ai-dividend',
]);

/** Futuristic endpoints get 7-day cache (604800s) instead of 24hr */
const LONG_CACHE_ENDPOINTS = new Set([
  'ai-gdp-contribution', 'automation-velocity-index', 'ai-labor-displacement-rate',
  'model-market-index', 'ai-dependency-score', 'compute-purchasing-power',
  'skill-half-life', 'cognitive-augmentation-index', 'human-premium-index',
  'reskilling-roi', 'workforce-composition', 'talent-migration-flow',
  'synthetic-media-index', 'digital-identity-index', 'algorithmic-governance-score',
  'attention-economy-price', 'digital-commons-health', 'trust-infrastructure-index',
  'carbon-credit-market', 'planetary-boundary-index', 'ecosystem-service-valuation',
  'climate-adaptation-bond', 'energy-transition-tracker', 'stranded-asset-risk',
  'ubi-effectiveness-index', 'abundance-index', 'prosperity-beyond-gdp',
  'creative-economy-index', 'time-sovereignty-index', 'inequality-adjusted-ai-dividend',
]);

const DAILY_LIMIT = 100;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed. Use GET.' });

  const endpoint = req.query.endpoint;
  if (!endpoint || !VALID_ENDPOINTS.has(endpoint)) {
    return res.status(404).json({
      error: 'Unknown endpoint',
      available: Array.from(VALID_ENDPOINTS).sort(),
    });
  }

  const apiKey = req.headers['x-api-key'];
  if (!apiKey || !apiKey.startsWith('nav_')) {
    return res.status(401).json({ error: 'Missing or invalid API key. Include X-API-Key header.' });
  }

  const r = getRedis();

  try {
    // Validate key
    const keyData = await r.hgetall(`apikey:${apiKey}`);
    if (!keyData || !keyData.key) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    if (keyData.status !== 'active') {
      return res.status(403).json({ error: 'API key has been revoked' });
    }

    // Expiry check (also handles legacy keys without expires field)
    if (!keyData.expires || new Date(keyData.expires) < new Date()) {
      await r.hset(`apikey:${apiKey}`, { status: 'expired' });
      return res.status(401).json({
        error: 'Token expired. Generate a new one at alexnavada.xyz/api-library',
        expired: true,
      });
    }

    // Rate limiting
    const today = new Date().toISOString().split('T')[0];
    const rateKey = `apikey:rate:${apiKey}:${today}`;
    const currentCount = Number(await r.get(rateKey) || 0);

    if (currentCount >= DAILY_LIMIT) {
      res.setHeader('X-RateLimit-Limit', DAILY_LIMIT);
      res.setHeader('X-RateLimit-Remaining', 0);
      return res.status(429).json({
        error: 'Rate limit exceeded',
        limit: DAILY_LIMIT,
        resets: 'midnight UTC',
      });
    }

    // Increment rate counter and update last_used
    await Promise.all([
      r.incr(rateKey),
      currentCount === 0 ? r.expire(rateKey, 86400) : Promise.resolve(),
      r.hset(`apikey:${apiKey}`, { last_used: new Date().toISOString() }),
    ]);

    const remaining = DAILY_LIMIT - currentCount - 1;
    res.setHeader('X-RateLimit-Limit', DAILY_LIMIT);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));

    // Build param-aware cache key and check Redis
    const params = Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== 'endpoint'));
    const cacheKey = buildCacheKey(endpoint, req.query);
    const cached = await r.get(cacheKey);

    if (cached) {
      const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
      return res.status(200).json({
        endpoint,
        data: parsed,
        cached_at: parsed._cached_at || null,
        params,
      });
    }

    // Cache miss — dispatch to handler
    const result = await dispatch(endpoint, params);
    result._cached_at = new Date().toISOString();

    // Cache: 7 days for futuristic endpoints, 24 hours for others
    const cacheTTL = LONG_CACHE_ENDPOINTS.has(endpoint) ? 604800 : 86400;
    await r.set(cacheKey, JSON.stringify(result), { ex: cacheTTL });

    return res.status(200).json({
      endpoint,
      data: result,
      cached_at: result._cached_at,
      params,
    });
  } catch (e) {
    console.error(`API v1/${endpoint} error:`, e);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
