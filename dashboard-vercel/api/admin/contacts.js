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
    const emails = await r.smembers('contacts:index');
    if (!emails || !emails.length) return res.status(200).json({ contacts: [], total: 0 });

    const contacts = [];
    for (const email of emails) {
      const contact = await r.hgetall(`contact:${email}`);
      if (!contact || !contact.email) continue;

      // Get current key data for status/expiry/last_used
      let keyStatus = 'unknown';
      let keyExpires = '';
      let lastUsed = '';
      if (contact.current_key) {
        const keyData = await r.hgetall(`apikey:${contact.current_key}`);
        if (keyData && keyData.key) {
          keyStatus = keyData.status || 'unknown';
          keyExpires = keyData.expires || '';
          lastUsed = keyData.last_used || '';
          // Check if expired by date
          if (keyStatus === 'active' && (!keyExpires || new Date(keyExpires) < new Date())) {
            keyStatus = 'expired';
          }
        }
      }

      contacts.push({
        name: contact.name || '',
        email: contact.email,
        first_registered: contact.first_registered || '',
        last_renewed: contact.last_renewed || '',
        token_status: keyStatus,
        token_expires: keyExpires,
        last_active: lastUsed,
      });
    }

    contacts.sort((a, b) => new Date(b.last_renewed || 0) - new Date(a.last_renewed || 0));
    return res.status(200).json({ contacts, total: contacts.length });
  } catch (e) {
    console.error('Admin contacts error:', e);
    return res.status(500).json({ error: 'Failed to get contacts' });
  }
};
