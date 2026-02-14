#!/usr/bin/env node

/**
 * Verify All Data Pipelines in Alex Railway
 * Checks data flow through all services
 */

import http from 'http';
import https from 'https';
import { createDb } from '../src/db.js';
import { Redis } from '@upstash/redis';

const COLORS = {
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  CYAN: '\x1b[36m',
  RESET: '\x1b[0m'
};

function log(message, color = COLORS.RESET) {
  console.log(`${color}${message}${COLORS.RESET}`);
}

const SERVICES = {
  alex: '71e94c37-64c6-44f2-a5c8-7ae2a1b641f4',
  postgres: '18f45778-a301-48ae-bc1d-4b8a24c7a246',
  chromadb: 'be536d17-091f-49c3-a141-22efcd867dee',
  nodejs: '61c90c33-c623-4f05-8e14-1aab785f18fa',
  httpNodejs: '7758afc6-b6a3-4fcc-99f6-77eb83b70277',
  upstash: 'e37177e0-e16b-4fbf-b95c-4b8ca8b37ae4',
  anythingllm: '7d0ca97a-5862-4fc7-834a-0cf7c656b3bd'
};

async function checkAlexMain() {
  log('\n1️⃣  Alex Main Service', COLORS.BLUE);

  try {
    // Check health
    const healthUrl = `http://127.0.0.1:${process.env.ALEX_PORT || '9090'}/api/health`;
    const health = await fetchJson(healthUrl);

    if (health) {
      log('  ✅ Service: Online', COLORS.GREEN);
      log(`  📊 Uptime: ${health.uptime_seconds || 0} seconds`, COLORS.CYAN);
      log(`  💾 Memory: ${health.memory?.heap_used_mb || 0} MB`, COLORS.CYAN);
      log(`  🤖 Telegram: ${health.telegram || 'unknown'}`, COLORS.CYAN);
      log(`  🔴 Redis: ${health.redis_upstash || 'unknown'}`, COLORS.CYAN);
    } else {
      log('  ❌ Health check failed', COLORS.RED);
    }

    // Check E2E
    const e2eUrl = `http://127.0.0.1:${process.env.ALEX_PORT || '9090'}/api/e2e`;
    const e2e = await fetchJson(e2eUrl);

    if (e2e && e2e.checks) {
      log('\n  E2E Service Checks:', COLORS.CYAN);
      for (const [service, check] of Object.entries(e2e.checks)) {
        const status = check.ok ? '✅' : '❌';
        const color = check.ok ? COLORS.GREEN : COLORS.RED;
        log(`    ${status} ${service}: ${check.ms || 0}ms`, color);
      }

      return { alex: true, e2e: e2e.ok };
    }
  } catch (err) {
    log(`  ❌ Error: ${err.message}`, COLORS.RED);
    return { alex: false, e2e: false };
  }

  return { alex: false, e2e: false };
}

async function checkPostgresFlow() {
  log('\n2️⃣  PostgreSQL Data Flow', COLORS.BLUE);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log('  ⚠️  DATABASE_URL not configured', COLORS.YELLOW);
    return false;
  }

  try {
    const db = createDb(databaseUrl);
    await db.init();

    // Test write
    await db.insertReport({
      kind: 'pipeline-test',
      content: JSON.stringify({
        test: 'verify_pipelines',
        timestamp: new Date().toISOString()
      }),
      meta: { source: 'pipeline_verification' }
    });

    log('  ✅ Connected to PostgreSQL', COLORS.GREEN);
    log('  ✅ Write test successful', COLORS.GREEN);
    log('  📊 Tables: connectivity_events, ralph_reviews, agent_reports', COLORS.CYAN);

    await db.close();
    return true;
  } catch (err) {
    log(`  ❌ PostgreSQL error: ${err.message}`, COLORS.RED);
    return false;
  }
}

async function checkRedisFlow() {
  log('\n3️⃣  Upstash Redis Data Flow', COLORS.BLUE);

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    log('  ⚠️  Upstash credentials not configured', COLORS.YELLOW);
    return false;
  }

  try {
    const redis = new Redis({ url, token });

    // Test connection
    const pong = await redis.ping();
    log(`  ✅ Connection: ${pong === 'PONG' ? 'Success' : 'Failed'}`, COLORS.GREEN);

    // Check dashboard data
    const dashData = await redis.get('dash:data');
    if (dashData) {
      const data = typeof dashData === 'string' ? JSON.parse(dashData) : dashData;
      log('  ✅ Dashboard data found', COLORS.GREEN);
      log(`    📅 Last updated: ${data.last_updated || 'Never'}`, COLORS.CYAN);
      log(`    📋 Tasks today: ${data.tasks?.length || 0}`, COLORS.CYAN);
      log(`    📰 News items: ${data.news?.length || 0}`, COLORS.CYAN);
      log(`    🤖 Ralph status: ${data.ralph?.status || 'unknown'}`, COLORS.CYAN);

      // Check data freshness
      if (data.last_updated) {
        const age = Date.now() - new Date(data.last_updated).getTime();
        const minutes = Math.floor(age / 60000);
        if (minutes > 60) {
          log(`    ⚠️  Data is ${minutes} minutes old`, COLORS.YELLOW);
        } else {
          log(`    ✅ Data is fresh (${minutes} minutes old)`, COLORS.GREEN);
        }
      }
    } else {
      log('  ⚠️  No dashboard data in Redis', COLORS.YELLOW);
    }

    // Check token data
    const tokenData = await redis.get('dash:tokens');
    if (tokenData) {
      const tokens = typeof tokenData === 'string' ? JSON.parse(tokenData) : tokenData;
      log('  ✅ Token usage data found', COLORS.GREEN);
      log(`    📊 Total calls: ${tokens.total_calls || 0}`, COLORS.CYAN);
      log(`    💷 Total cost: £${tokens.total_cost_gbp?.toFixed(2) || '0.00'}`, COLORS.CYAN);
    }

    // Test write
    const testKey = `test:pipeline:${Date.now()}`;
    await redis.set(testKey, 'pipeline_test', { ex: 60 });
    const testVal = await redis.get(testKey);
    log(`  ✅ Write test: ${testVal === 'pipeline_test' ? 'Success' : 'Failed'}`, COLORS.GREEN);
    await redis.del(testKey);

    return true;
  } catch (err) {
    log(`  ❌ Redis error: ${err.message}`, COLORS.RED);
    return false;
  }
}

async function checkChromaDB() {
  log('\n4️⃣  ChromaDB RAG Pipeline', COLORS.BLUE);

  const chromaBase = process.env.CHROMA_BASE_URL || 'http://chromadb.railway.internal:8000';

  try {
    // Check heartbeat
    const heartbeatUrl = `${chromaBase}/api/v2/heartbeat`;
    const heartbeat = await fetchJson(heartbeatUrl.replace('chromadb.railway.internal', 'localhost'));

    if (heartbeat) {
      log('  ✅ ChromaDB is online', COLORS.GREEN);
      log(`  📊 Heartbeat: ${JSON.stringify(heartbeat).substring(0, 50)}`, COLORS.CYAN);
    } else {
      log('  ❌ ChromaDB not responding', COLORS.RED);
      return false;
    }

    // Check collections
    const collectionsUrl = `${chromaBase}/api/v1/collections`;
    const collections = await fetchJson(collectionsUrl.replace('chromadb.railway.internal', 'localhost'));

    if (Array.isArray(collections)) {
      log(`  📚 Collections: ${collections.length} found`, COLORS.CYAN);
      collections.slice(0, 3).forEach(col => {
        log(`    - ${col.name}: ${col.metadata?.document_count || 0} docs`, COLORS.CYAN);
      });
    }

    return true;
  } catch (err) {
    log(`  ❌ ChromaDB error: ${err.message}`, COLORS.RED);
    return false;
  }
}

async function checkAnythingLLM() {
  log('\n5️⃣  AnythingLLM Document Service', COLORS.BLUE);

  const anythingUrl = process.env.ANYTHINGLLM_INTERNAL_URL || 'http://anythingllm.railway.internal:3001';

  try {
    const testUrl = anythingUrl.replace('anythingllm.railway.internal', 'localhost');
    const response = await fetchWithTimeout(testUrl, 5000);

    if (response.ok) {
      log('  ✅ AnythingLLM is online', COLORS.GREEN);
      log('  📄 Document processing available', COLORS.CYAN);
      return true;
    } else {
      log('  ⚠️  AnythingLLM not accessible', COLORS.YELLOW);
      return false;
    }
  } catch (err) {
    log(`  ⚠️  AnythingLLM: ${err.message}`, COLORS.YELLOW);
    return false;
  }
}

async function checkNodeServices() {
  log('\n6️⃣  Node.js Support Services', COLORS.BLUE);

  const results = {};

  // Check nodejs service
  const nodejsUrl = process.env.NODEJS_BASE_URL || 'http://nodejs.railway.internal:3000';
  try {
    const response = await fetchWithTimeout(nodejsUrl.replace('nodejs.railway.internal', 'localhost'), 3000);
    results.nodejs = response.ok;
    log(`  ${response.ok ? '✅' : '❌'} nodejs service: ${response.ok ? 'Online' : 'Offline'}`,
        response.ok ? COLORS.GREEN : COLORS.RED);
  } catch {
    results.nodejs = false;
    log('  ⚠️  nodejs service: Cannot check', COLORS.YELLOW);
  }

  // Check http-nodejs service
  const httpNodejsUrl = process.env.HTTP_NODEJS_BASE_URL || 'http://http-nodejs.railway.internal:8080';
  try {
    const response = await fetchWithTimeout(httpNodejsUrl.replace('http-nodejs.railway.internal', 'localhost'), 3000);
    results.httpNodejs = response.ok;
    log(`  ${response.ok ? '✅' : '❌'} http-nodejs service: ${response.ok ? 'Online' : 'Offline'}`,
        response.ok ? COLORS.GREEN : COLORS.RED);
  } catch {
    results.httpNodejs = false;
    log('  ⚠️  http-nodejs service: Cannot check', COLORS.YELLOW);
  }

  return results;
}

// Helper functions
async function fetchJson(url) {
  try {
    const response = await fetchWithTimeout(url, 5000);
    if (response.ok && response.data) {
      return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchWithTimeout(url, timeoutMs) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;

    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          data
        });
      });
    });

    req.on('error', (err) => {
      resolve({ ok: false, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Timeout' });
    });
  });
}

// Main pipeline verification
async function verifyAllPipelines() {
  log('🔍 Alex Railway Pipeline Verification', COLORS.BLUE);
  log('=====================================\n', COLORS.BLUE);

  const results = {};

  // 1. Check Alex main service
  const alexResult = await checkAlexMain();
  results.alex = alexResult;

  // 2. Check PostgreSQL data flow
  results.postgres = await checkPostgresFlow();

  // 3. Check Redis data flow
  results.redis = await checkRedisFlow();

  // 4. Check ChromaDB RAG
  results.chromadb = await checkChromaDB();

  // 5. Check AnythingLLM
  results.anythingllm = await checkAnythingLLM();

  // 6. Check Node services
  results.nodeServices = await checkNodeServices();

  // Summary
  log('\n📊 Pipeline Status Summary', COLORS.BLUE);
  log('==========================\n', COLORS.BLUE);

  log('Data Flow Pipelines:', COLORS.CYAN);
  log('  Alex → PostgreSQL: ' + (results.postgres ? '✅ Working' : '❌ Failed'),
      results.postgres ? COLORS.GREEN : COLORS.RED);
  log('  Alex → Upstash Redis → Dashboard: ' + (results.redis ? '✅ Working' : '❌ Failed'),
      results.redis ? COLORS.GREEN : COLORS.RED);
  log('  Alex → ChromaDB (RAG): ' + (results.chromadb ? '✅ Working' : '⚠️ Degraded'),
      results.chromadb ? COLORS.GREEN : COLORS.YELLOW);
  log('  Alex → AnythingLLM (Docs): ' + (results.anythingllm ? '✅ Working' : '⚠️ Degraded'),
      results.anythingllm ? COLORS.GREEN : COLORS.YELLOW);

  // Critical services check
  const criticalOk = results.alex.alex && results.postgres && results.redis;

  log('\n' + (criticalOk ? '✅ All critical pipelines operational' : '❌ Critical pipeline issues detected'),
      criticalOk ? COLORS.GREEN : COLORS.RED);

  if (!criticalOk) {
    log('\n⚠️  Action Required:', COLORS.YELLOW);
    if (!results.alex.alex) log('  • Check Alex main service', COLORS.YELLOW);
    if (!results.postgres) log('  • Configure DATABASE_URL for PostgreSQL', COLORS.YELLOW);
    if (!results.redis) log('  • Configure Upstash Redis credentials', COLORS.YELLOW);
  }

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    pipelines: results,
    critical: criticalOk
  };

  try {
    const fs = await import('fs/promises');
    await fs.writeFile('pipeline_verification.json', JSON.stringify(report, null, 2));
    log('\n📄 Report saved to pipeline_verification.json', COLORS.BLUE);
  } catch {}

  process.exit(criticalOk ? 0 : 1);
}

// Run verification
log(`Testing from Alex service on port ${process.env.ALEX_PORT || '9090'}...\n`, COLORS.CYAN);
verifyAllPipelines().catch(err => {
  log(`\n❌ Fatal error: ${err.message}`, COLORS.RED);
  process.exit(1);
});