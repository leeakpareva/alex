import { createServer } from 'http';
import { createClient } from 'redis';

const PORT = Number(process.env.PORT || 8080);
const AUTH_TOKEN = (process.env.EVENT_INGRESS_TOKEN || '').trim();
const REDIS_URL = (process.env.REDIS_URL || '').trim();

// List key is intentionally simple and stable: Alex consumes this.
const REDIS_LIST_KEY = (process.env.ALEX_EVENT_QUEUE_KEY || 'alex:events').trim();

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limitBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('Body too large'), { code: 'ETOOBIG' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

let redis = null;
async function getRedis() {
  if (redis) return redis;
  if (!REDIS_URL) throw new Error('REDIS_URL missing');
  redis = createClient({ url: REDIS_URL });
  redis.on('error', (e) => console.error('[redis]', e?.message || e));
  await redis.connect();
  console.log('[redis] connected');
  return redis;
}

function requireAuth(req) {
  if (!AUTH_TOKEN) return { ok: false, status: 500, error: 'EVENT_INGRESS_TOKEN not set' };
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${AUTH_TOKEN}`) return { ok: false, status: 401, error: 'Unauthorized' };
  return { ok: true };
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
      return sendJson(res, 200, { ok: true, service: 'http-nodejs', role: 'event-ingress' });
    }

    if (req.method === 'POST' && req.url === '/event') {
      const a = requireAuth(req);
      if (!a.ok) return sendJson(res, a.status, { ok: false, error: a.error });

      const raw = await readBody(req);
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
      }

      // Expected: { type: 'trigger_task'|'command'|..., payload: {...}, source?: '...' }
      const msg = {
        id: cryptoRandomId(),
        ts: new Date().toISOString(),
        type: body.type || 'unknown',
        source: body.source || 'external',
        payload: body.payload ?? body,
      };

      const r = await getRedis();
      await r.lPush(REDIS_LIST_KEY, JSON.stringify(msg));
      // Keep queue bounded (avoid unbounded Redis growth if Alex is down)
      await r.lTrim(REDIS_LIST_KEY, 0, 999);

      return sendJson(res, 200, { ok: true, enqueued: true, id: msg.id });
    }

    return sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (e) {
    const msg = e?.message || String(e);
    const status = e?.code === 'ETOOBIG' ? 413 : 500;
    return sendJson(res, status, { ok: false, error: msg });
  }
});

server.listen(PORT, () => {
  console.log(`[http-nodejs] listening on :${PORT}`);
});

function cryptoRandomId() {
  // Avoid importing crypto in the hot path; Node 22 has global crypto.
  try {
    return crypto.randomUUID();
  } catch {
    return `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}
