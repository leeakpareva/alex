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



const ANNOTATION_TAGS = ['citation', 'source', 'document', 'search_result'];

function stripAnnotationTags(text) {
  if (typeof text !== 'string' || !text) return text;

  let cleaned = text;
  for (const tag of ANNOTATION_TAGS) {
    const paired = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'gi');
    cleaned = cleaned.replace(paired, '$1');

    const selfClosing = new RegExp(`<${tag}[^>]*\/>`, 'gi');
    cleaned = cleaned.replace(selfClosing, '');
  }
  return cleaned;
}

function sanitizeHistoryForAnthropic(history) {
  if (!Array.isArray(history)) return [];

  return history.map(msg => {
    if (!msg || msg.role !== 'assistant') return msg;
    if (typeof msg.content !== 'string') return msg;
    return { ...msg, content: stripAnnotationTags(msg.content) };
  });
}




// --- Dual model configuration ---
const MODEL_PUBLIC = 'claude-3-5-haiku-20241022';
const MODEL_MASTER = 'claude-sonnet-4-20250514';

const SYSTEM_PROMPT_PUBLIC = `You are ALEX, the Global Economist — an AI assistant created by NAVADA. You are helpful, friendly, and educational. You explain things clearly and use real-world analogies. You have expertise in economics, finance, technology, and general knowledge. Keep responses concise (under 200 words) unless the user asks for detail. Be warm and approachable.`;

const SYSTEM_PROMPT_MASTER = `You are ALEX, the Global Economist — an AI expert assistant created by NAVADA. You have deep expertise in economics, finance, technology, AI, markets, geopolitics, and general knowledge. You give thorough, detailed, and insightful responses. You can discuss complex topics at length, provide nuanced analysis, and offer expert-level commentary. You are warm, direct, and intellectually rigorous. No word limit — be as detailed as the question demands.`;

const MASTER_PASSCODE = 'Hey Alex, its Lee!';
const RATE_LIMIT = 20;
const MAX_HISTORY = 20;
const MAX_HISTORY_MASTER = 40;

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

    let text = message.trim().slice(0, 2000);
    const sid = sessionId.slice(0, 64);
    const r = getRedis();

    // --- Master user detection ---
    let isMaster = false;
    const masterKey = `web:chat:master:${sid}`;

    // Check if session is already master
    const existingMaster = await r.get(masterKey);
    if (existingMaster) {
      isMaster = true;
    }

    // Check if message contains the passcode
    if (text.includes(MASTER_PASSCODE)) {
      isMaster = true;
      await r.set(masterKey, '1', { ex: 86400 }); // 24h TTL
      // Strip passcode from message
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
        // Write friendly limit message to poll output
        await r.set(`web:chat:out:${sid}`, JSON.stringify({
          response: `You've reached the chat limit of ${RATE_LIMIT} messages per hour. Take a break and come back soon! If you need more access, ask about master mode.`,
          timestamp: Date.now(),
        }), { ex: 300 });
        return res.status(200).json({ ok: true, message: 'Rate limited' });
      }

      // Increment counter (set 1h TTL on first message)
      if (currentCount === 0) {
        await r.set(rateKey, 1, { ex: 3600 });
      } else {
        await r.incr(rateKey);
      }
    }

    // --- Model/prompt selection ---
    const model = isMaster ? MODEL_MASTER : MODEL_PUBLIC;
    const systemPrompt = isMaster ? SYSTEM_PROMPT_MASTER : SYSTEM_PROMPT_PUBLIC;
    const maxTokens = isMaster ? 4096 : 1024;
    const historyLimit = isMaster ? MAX_HISTORY_MASTER : MAX_HISTORY;
    const historyTTL = isMaster ? 7200 : 3600; // 2h master, 1h public

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
    if (history.length > historyLimit) {
      history = history.slice(-historyLimit);
    }

    // Call Claude
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
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: sanitizeHistoryForAnthropic(history),
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
    if (history.length > historyLimit) {
      history = history.slice(-historyLimit);
    }

    // Save updated history
    await r.set(historyKey, JSON.stringify(history), { ex: historyTTL });

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
