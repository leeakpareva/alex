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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, email } = req.body || {};

    // Validate email (mandatory)
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const r = getRedis();
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Check for existing contact (renewal flow)
    const [existingKey, existingContact] = await Promise.all([
      r.get(`email:to:key:${normalizedEmail}`),
      r.hgetall(`contact:${normalizedEmail}`),
    ]);
    let contactName;
    let isRenewal = false;

    if (existingKey) {
      // Renewal flow — expire old key
      isRenewal = true;
      await Promise.all([
        r.hset(`apikey:${existingKey}`, { status: 'expired' }),
        r.srem('apikeys:index', existingKey),
      ]);

      // Pull name from existing contact if not provided
      contactName = (name && typeof name === 'string' && name.trim().length >= 2)
        ? name.trim().slice(0, 100)
        : (existingContact && existingContact.name) || 'User';
    } else {
      // New registration — name is required
      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        return res.status(400).json({ error: 'Name (min 2 characters) is required' });
      }
      contactName = name.trim().slice(0, 100);
    }

    // Generate new key
    const key = 'nav_' + crypto.randomBytes(16).toString('hex');

    const keyData = {
      name: contactName,
      email: normalizedEmail,
      key,
      created: now,
      expires,
      status: 'active',
      requests_today: 0,
      last_used: '',
    };

    const contactData = {
      name: contactName,
      email: normalizedEmail,
      first_registered: (existingContact && existingContact.first_registered) || now,
      current_key: key,
      last_renewed: now,
    };

    await Promise.all([
      r.hset(`apikey:${key}`, keyData),
      r.sadd('apikeys:index', key),
      r.hset(`contact:${normalizedEmail}`, contactData),
      r.set(`email:to:key:${normalizedEmail}`, key),
      r.sadd('contacts:index', normalizedEmail),
    ]);

    return res.status(201).json({
      key,
      name: contactName,
      email: normalizedEmail,
      created: now,
      expires,
      is_renewal: isRenewal,
    });
  } catch (e) {
    console.error('Key generation error:', e);
    return res.status(500).json({ error: 'Failed to generate key' });
  }
};
