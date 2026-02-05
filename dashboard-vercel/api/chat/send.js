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

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-3-5-haiku-20241022';
const MAX_HISTORY = 20;
const SYSTEM_PROMPT = `You are ALEX, the Global Economist — an AI assistant created by NAVADA. You are helpful, friendly, and educational. You explain things clearly and use real-world analogies. You have expertise in economics, finance, technology, and general knowledge. Keep responses concise (under 200 words) unless the user asks for detail. Be warm and approachable.`;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, sessionId } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    const text = message.trim().slice(0, 2000);
    const sid = sessionId.slice(0, 64);
    const r = getRedis();

    // Load conversation history from Redis
    const historyKey = `web:chat:history:${sid}`;
    let history = [];
    try {
      const stored = await r.get(historyKey);
      if (stored) {
        history = typeof stored === 'string' ? JSON.parse(stored) : stored;
      }
    } catch (e) { /* start fresh */ }

    // Add user message to history
    history.push({ role: 'user', content: text });
    // Keep only last N messages
    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
    }

    // Call Claude Haiku
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await r.set(`web:chat:out:${sid}`, JSON.stringify({
        response: 'Sorry, the chat service is not configured yet. Please try again later.',
        timestamp: Date.now(),
      }), { ex: 300 });
      return res.status(200).json({ ok: true });
    }

    const aiRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: history,
      }),
    });

    let responseText;
    if (!aiRes.ok) {
      responseText = 'Sorry, I\'m having trouble thinking right now. Please try again in a moment.';
    } else {
      const aiData = await aiRes.json();
      responseText = aiData.content?.[0]?.text || 'I didn\'t have a response for that. Could you rephrase?';
    }

    // Add assistant response to history
    history.push({ role: 'assistant', content: responseText });
    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
    }

    // Save updated history (expire after 1 hour of inactivity)
    await r.set(historyKey, JSON.stringify(history), { ex: 3600 });

    // Write response for poll.js to pick up
    await r.set(`web:chat:out:${sid}`, JSON.stringify({
      response: responseText,
      timestamp: Date.now(),
    }), { ex: 300 });

    return res.status(200).json({ ok: true, message: 'Message sent' });
  } catch (e) {
    console.error('Chat send error:', e);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
