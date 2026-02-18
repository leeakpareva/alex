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

const MASTER_PASSCODE = 'Hey Alex, its Lee!';
const PASSCODE = 'ALEX_NAVADA';
const RATE_LIMIT = 20;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, sessionId, isMaster: masterFlag } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    let text = message.trim().slice(0, 2000);
    const sid = sessionId.slice(0, 64);
    const r = getRedis();

    // --- Master user detection ---
    let isMaster = !!masterFlag;
    const masterKey = `web:chat:master:${sid}`;

    // Check if session is already master
    const existingMaster = await r.get(masterKey);
    if (existingMaster) {
      isMaster = true;
    }

    // Check if message contains the master passcode
    if (text.includes(MASTER_PASSCODE)) {
      isMaster = true;
      await r.set(masterKey, '1', { ex: 86400 }); // 24h TTL
      text = text.replace(MASTER_PASSCODE, '').trim();
      if (!text) {
        text = 'Hello! I just connected.';
      }
    }

    // --- Rate limiting (public users only) ---
    if (!isMaster) {
      const rateKey = `web:chat:rate:${sid}`;
      const currentCount = Number(await r.get(rateKey)) || 0;

      if (currentCount >= RATE_LIMIT) {
        await r.set(`web:chat:out:${sid}`, JSON.stringify({
          response: `You've reached the chat limit of ${RATE_LIMIT} messages per hour. Take a break and come back soon!`,
          attachments: [],
          tools_used: [],
          timestamp: Date.now(),
        }), { ex: 300 });
        return res.status(200).json({ ok: true, message: 'Rate limited' });
      }

      if (currentCount === 0) {
        await r.set(rateKey, 1, { ex: 3600 });
      } else {
        await r.incr(rateKey);
      }
    }

    // Push to Redis queue for gateway.js web chat poller to pick up
    await r.rpush('web:chat:in', JSON.stringify({
      text,
      sessionId: sid,
      isMaster,
      timestamp: Date.now(),
    }));

    // Audit log
    await r.lpush('audit:log', JSON.stringify({
      channel: 'web',
      type: 'user_message',
      user: isMaster ? `Master (${sid.slice(0,8)})` : `Web (${sid.slice(0,8)})`,
      message: text.slice(0, 200),
      timestamp: new Date().toISOString(),
      meta: { session_id: sid, master: isMaster }
    }));
    await r.ltrim('audit:log', 0, 499);

    return res.status(200).json({ ok: true, message: 'Message queued' });
  } catch (e) {
    console.error('Chat send error:', e);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
