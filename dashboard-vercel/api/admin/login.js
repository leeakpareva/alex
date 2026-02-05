const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword || password !== adminPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const secret = process.env.ADMIN_SECRET || 'fallback-secret';
    const payload = Buffer.from(JSON.stringify({ ts: Date.now() })).toString('base64');
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const token = `${payload}.${sig}`;

    res.setHeader('Set-Cookie', `admin_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Admin login error:', e);
    return res.status(500).json({ error: 'Login failed' });
  }
};
