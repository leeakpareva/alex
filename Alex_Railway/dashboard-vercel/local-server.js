/**
 * Local dev server for dashboard-vercel — mimics Vercel routing locally.
 * Usage: node local-server.js
 * Then visit http://localhost:3333
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Load .env.local
const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const PORT = 3333;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

// API handler loader
function loadHandler(filePath) {
  delete require.cache[require.resolve(filePath)];
  return require(filePath);
}

// Mock Vercel req/res
function createRes(raw) {
  const res = {
    statusCode: 200,
    headers: {},
    status(code) { res.statusCode = code; return res; },
    json(data) {
      raw.writeHead(res.statusCode, { ...res.headers, 'Content-Type': 'application/json' });
      raw.end(JSON.stringify(data));
    },
    end(body) {
      raw.writeHead(res.statusCode, res.headers);
      raw.end(body || '');
    },
    setHeader(k, v) { res.headers[k] = v; },
  };
  return res;
}

const server = http.createServer(async (req, rawRes) => {
  const parsed = url.parse(req.url, true);
  let pathname = parsed.pathname;

  // CORS headers for API routes
  if (pathname.startsWith('/api/')) {
    rawRes.setHeader('Access-Control-Allow-Origin', '*');
    rawRes.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    rawRes.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-API-Key');
    if (req.method === 'OPTIONS') { rawRes.writeHead(200); rawRes.end(); return; }
  }

  // Parse body for POST
  let body = '';
  if (req.method === 'POST') {
    await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
    try { req.body = JSON.parse(body); } catch { req.body = {}; }
  }
  req.query = parsed.query;

  // API routing
  try {
    // /api/v1/:endpoint
    const v1Match = pathname.match(/^\/api\/v1\/([a-z-]+)$/);
    if (v1Match) {
      req.query.endpoint = v1Match[1];
      const handler = loadHandler('./api/v1/[endpoint].js');
      return await handler(req, createRes(rawRes));
    }

    // /api/keys/*, /api/chat/*, /api/admin/*
    const apiMatch = pathname.match(/^\/api\/(.+)$/);
    if (apiMatch) {
      const apiFile = path.join(__dirname, 'api', apiMatch[1] + '.js');
      if (fs.existsSync(apiFile)) {
        const handler = loadHandler(apiFile);
        return await handler(req, createRes(rawRes));
      }
    }

    // /qr → api/qr.js redirect
    if (pathname === '/qr') {
      const handler = loadHandler('./api/qr.js');
      return await handler(req, createRes(rawRes));
    }

    // Page rewrites
    const rewrites = {
      '/': '/public/home.html',
      '/dashboard': '/public/dashboard.html',
      '/api-library': '/public/api-library.html',
      '/chat': '/public/chat.html',
      '/experiment': '/public/experiment.html',
      '/experiment/phase-1': '/public/experiment-phase-1.html',
      '/experiment/phase-2': '/public/experiment-phase-2.html',
      '/experiment/phase-3': '/public/experiment-phase-3.html',
      '/experiment/phase-4': '/public/experiment-phase-4.html',
      '/live-log': '/public/live-log.html',
      '/articles': '/public/articles.html',
      '/articles/alex-vs-openclaw': '/public/alex-vs-openclaw.html',
      '/contact': '/public/contact.html',
      '/faq': '/public/faq.html',
      '/terms': '/public/terms.html',
      '/navada-admin': '/public/navada-admin.html',
      '/redis-viewer': '/public/redis-viewer.html',
      '/api-learn': '/public/api-learn.html',
    };
    if (rewrites[pathname]) pathname = rewrites[pathname];

    // Static files from /public
    let filePath;
    if (pathname.startsWith('/public/')) {
      filePath = path.join(__dirname, pathname);
    } else {
      filePath = path.join(__dirname, 'public', pathname);
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      rawRes.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
      fs.createReadStream(filePath).pipe(rawRes);
    } else {
      rawRes.writeHead(404, { 'Content-Type': 'text/plain' });
      rawRes.end('Not found');
    }
  } catch (err) {
    console.error('Error:', err);
    rawRes.writeHead(500, { 'Content-Type': 'application/json' });
    rawRes.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Dashboard local dev server running at:`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  http://$(hostname -I | awk '{print $1}'):${PORT}\n`);
  console.log(`  Pages:`);
  console.log(`    /                        Home`);
  console.log(`    /dashboard               Dashboard`);
  console.log(`    /api-library             API Library`);
  console.log(`    /chat                    Chat with ALEX`);
  console.log(`    /experiment              Experiment`);
  console.log(`    /experiment/phase-1      Phase 1: Copilot Integration`);
  console.log(`    /experiment/phase-2      Phase 2: Value Quantification`);
  console.log(`    /experiment/phase-3      Phase 3: Dynamic Compensation`);
  console.log(`    /experiment/phase-4      Phase 4: Tokenized Economy`);
  console.log(`    /live-log                Live Log`);
  console.log(`    /articles                Articles`);
  console.log(`    /articles/alex-vs-openclaw  ALEX vs OpenClaw`);
  console.log(`    /contact                 Contact`);
  console.log(`    /faq                     AI FAQ`);
  console.log(`    /terms                   Terms of Service`);
  console.log(`    /navada-admin            Admin Panel (password: check .env.local)`);
  console.log(`    /redis-viewer            Redis Data Viewer (admin only)\n`);
});
